import {
  BadRequestError,
  ConflictError,
  type CreateItemInput,
  CreateItemSchema,
  IdResultSchema,
  ItemListResultSchema,
  ItemResultSchema,
  ItemVersionResultSchema,
  NotFoundError,
  RevealAccessResponseSchema,
  SuccessResultSchema,
  type UpdateItemInput,
  UpdateItemSchema,
} from "@abadge/core";
import { serverDecrypt, serverEncrypt } from "@abadge/crypto/server";
import {
  profileIdForServerAad,
  SERVER_AAD_MIN_VERSION,
  type ServerAadMeta,
} from "@abadge/crypto/shared";
import { and, desc, eq, isNull, sql, type Transaction } from "@abadge/db";
import { auditLogs, items, permissions, profiles } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { auditDeniedSession, logSessionAudit } from "../audit";
import { onItemDeleted } from "../cascades";
import {
  AgentRequestContextTag,
  isUniqueViolation,
  runAgentEffect,
  runSessionEffect,
  SessionRequestContextTag,
  strictSchema,
  tryAsync,
} from "../effect";
import { agentProcedure, createTrpcRouter, scopedSessionProcedure } from "../init";
import { resolveStoredLabel } from "../item-labels";
import { decodeServerManagedPayload } from "../item-payload";
import { serializeItemDetail, serializeItemSummary } from "../serialize";

const loadOwnedItem = (
  itemId: string,
  eventType: "item.read" | "item.update" | "item.export" | "item.delete",
) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [item] = yield* tryAsync(() =>
      ctx.db
        .select()
        .from(items)
        .where(
          and(
            eq(items.id, itemId),
            eq(items.organizationId, ctx.identity.organizationId),
            isNull(items.deletedAt),
          ),
        )
        .limit(1),
    );

    if (!item) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          itemId,
          eventType,
          reason: "not_found",
          ipAddress: ctx.ipAddress,
        },
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
          hint: "Check the item ID and make sure the item still exists for this account.",
        }),
      );
    }

    return item;
  });

/**
 * ZK insert under an advisory lock (§I5-RACE).
 * Resolves the first ZK profile in the org, takes `pg_advisory_xact_lock` on
 * it, re-reads keyVersion (defending against a rotate that committed between
 * the profile SELECT and the lock acquisition), optionally enforces CAS via
 * expectedKeyVersion, then inserts with cryptoVersion tagged to the current
 * keyVersion. Designed to be called from inside `ctx.db.transaction(...)`.
 */
async function insertZeroKnowledgeItem(
  tx: Transaction,
  opts: {
    id: string;
    userId: string;
    organizationId: string;
    label: string;
    encryptedItemKey: string;
    ciphertext: string;
    expectedKeyVersion: number | undefined;
  },
): Promise<void> {
  const [profile] = await tx
    .select({ id: profiles.id, keyVersion: profiles.keyVersion })
    .from(profiles)
    .where(
      and(
        eq(profiles.organizationId, opts.organizationId),
        eq(profiles.storageMode, "zero_knowledge"),
      ),
    )
    .limit(1);

  if (!profile) {
    throw new NotFoundError({
      code: "NOT_FOUND",
      message: "No zero-knowledge profile found",
      hint: "Create a ZK profile first or use server-managed storage mode.",
    });
  }

  // Raw SQL for pg_advisory_xact_lock: not expressible in Drizzle's typed API.
  // Released automatically on txn commit/rollback.
  // pg_advisory_xact_lock takes a single int; hashtext(uuid) collapses UUIDs into 32 bits.
  // Collisions are rare (<0.1% for 10K profiles) and benign — two unrelated profiles
  // occasionally serialize. Acceptable perf cost; correctness is unaffected.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${profile.id}))`);

  // Re-read keyVersion UNDER the lock; defends against a rotate that committed
  // between the profile SELECT and the advisory-lock acquisition.
  const [locked] = await tx
    .select({ keyVersion: profiles.keyVersion })
    .from(profiles)
    .where(eq(profiles.id, profile.id));

  if (!locked) {
    throw new NotFoundError({
      code: "NOT_FOUND",
      message: "Profile disappeared during create",
      hint: "Retry the request.",
    });
  }

  if (opts.expectedKeyVersion !== undefined && locked.keyVersion !== opts.expectedKeyVersion) {
    throw new ConflictError({
      code: "CONFLICT",
      message: "Profile key version advanced during item create",
      hint: "Re-derive the root key for the current keyVersion and retry.",
      meta: {
        expectedKeyVersion: opts.expectedKeyVersion,
        currentKeyVersion: locked.keyVersion,
      },
    });
  }

  await tx.insert(items).values({
    id: opts.id,
    createdBy: opts.userId,
    organizationId: opts.organizationId,
    profileId: profile.id,
    label: opts.label,
    storageMode: "zero_knowledge",
    encryptedItemKey: opts.encryptedItemKey,
    ciphertext: opts.ciphertext,
    cryptoVersion: locked.keyVersion,
  });
}

const createItem = (input: CreateItemInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;

    // §W1S7-001 — ZK branch: client supplies `id` because it is bound into the
    // XChaCha20-Poly1305 AAD at encrypt time. Server-managed items still mint
    // the id here (the AAD for AES-GCM is derived server-side).
    const id = input.storageMode === "zero_knowledge" ? input.id : crypto.randomUUID();

    if (input.storageMode === "zero_knowledge") {
      // tryAsync (not Effect.tryPromise) preserves the domain Error instance
      // thrown inside the tx callback, so toTrpcError's isDomainError check
      // maps ConflictError/NotFoundError to the correct tRPC code + cause.
      yield* tryAsync(() =>
        ctx.db.transaction((tx) =>
          insertZeroKnowledgeItem(tx, {
            id,
            userId,
            organizationId: ctx.identity.organizationId,
            label: resolveStoredLabel(id, input.label),
            encryptedItemKey: input.encryptedItemKey,
            ciphertext: input.ciphertext,
            expectedKeyVersion: input.expectedKeyVersion,
          }),
        ),
      ).pipe(
        // §W1S7-001 — a client-provided id that collides with an existing row
        // must surface as ConflictError, not a 500. The unique-violation is
        // the only domain-neutral DB error this insert can raise.
        Effect.catchIf(
          (e) => isUniqueViolation(e),
          () =>
            Effect.fail(
              new ConflictError({
                code: "ITEM_ALREADY_EXISTS",
                message: "An item with this id already exists",
                hint: "Generate a new UUID for the item id and retry.",
                meta: { itemId: id },
              }),
            ),
        ),
      );
    } else {
      const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
      // New server-managed writes are v2 AAD-bound (§W1S7-002). AAD binds
      // ciphertext to (orgId, profileId, itemId, keyVersion) so a DB-write
      // adversary cannot substitute rows across items or organizations.
      // `profileIdForServerAad` is shared with every decrypt site so the
      // null-profile fallback stays symmetric across encrypt and decrypt.
      const aadMeta: ServerAadMeta = {
        orgId: ctx.identity.organizationId,
        profileId: profileIdForServerAad(null),
        itemId: id,
        keyVersion: SERVER_AAD_MIN_VERSION,
      };
      const encrypted = yield* tryAsync(() =>
        serverEncrypt(plaintext, ctx.env.ENCRYPTION_KEY, SERVER_AAD_MIN_VERSION, aadMeta),
      );

      yield* tryAsync(() =>
        ctx.db.insert(items).values({
          id,
          createdBy: userId,
          organizationId: ctx.identity.organizationId,
          label: resolveStoredLabel(id, input.payload.label),
          storageMode: "server_managed",
          serverCiphertext: encrypted.ciphertext,
          serverIv: encrypted.iv,
          serverKeyVersion: encrypted.keyVersion,
        }),
      );
    }

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId,
      itemId: id,
      eventType: "item.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { id };
  });

const listItems = Effect.gen(function* () {
  const ctx = yield* SessionRequestContextTag;
  const result = yield* tryAsync(() =>
    ctx.db
      .select({
        id: items.id,
        label: items.label,
        storageMode: items.storageMode,
        cryptoVersion: items.cryptoVersion,
        contentVersion: items.contentVersion,
        createdAt: items.createdAt,
        updatedAt: items.updatedAt,
      })
      .from(items)
      .where(and(eq(items.organizationId, ctx.identity.organizationId), isNull(items.deletedAt)))
      .orderBy(desc(items.createdAt)),
  );

  return { items: result.map(serializeItemSummary) };
});

const listItemsForAgent = Effect.gen(function* () {
  const ctx = yield* AgentRequestContextTag;
  const result = yield* tryAsync(() =>
    ctx.db
      .selectDistinct({
        id: items.id,
        label: items.label,
        storageMode: items.storageMode,
        cryptoVersion: items.cryptoVersion,
        contentVersion: items.contentVersion,
        createdAt: items.createdAt,
        updatedAt: items.updatedAt,
      })
      .from(items)
      .innerJoin(permissions, eq(permissions.itemId, items.id))
      .where(
        and(
          eq(items.organizationId, ctx.identity.agentOrganizationId),
          eq(permissions.agentId, ctx.identity.agentId),
          isNull(items.deletedAt),
        ),
      )
      .orderBy(desc(items.createdAt)),
  );

  return { items: result.map(serializeItemSummary) };
});

const getItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const item = yield* loadOwnedItem(itemId, "item.read");

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      itemId,
      eventType: "item.read",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { item: serializeItemDetail(item) };
  });

const updateItem = (itemId: string, input: UpdateItemInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const item = yield* loadOwnedItem(itemId, "item.update");

    if (input.storageMode === "zero_knowledge") {
      const updated = yield* tryAsync(() =>
        ctx.db
          .update(items)
          .set({
            label: resolveStoredLabel(itemId, input.label),
            encryptedItemKey: input.encryptedItemKey,
            ciphertext: input.ciphertext,
            contentVersion: item.contentVersion + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(items.id, itemId), eq(items.contentVersion, input.contentVersion)))
          .returning({ id: items.id }),
      );

      if (updated.length === 0) {
        return yield* Effect.fail(
          new ConflictError({
            code: "STALE_VERSION",
            message: "Stale version — reload and retry",
            hint: "Refresh the item details and retry the update with the latest contentVersion.",
          }),
        );
      }
    } else {
      const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
      // Rewrite always lands as v2 AAD-bound, even when the prior row was v1.
      // This opportunistically migrates the row forward as it is touched.
      const aadMeta: ServerAadMeta = {
        orgId: ctx.identity.organizationId,
        profileId: profileIdForServerAad(item.profileId),
        itemId,
        keyVersion: SERVER_AAD_MIN_VERSION,
      };
      const encrypted = yield* tryAsync(() =>
        serverEncrypt(plaintext, ctx.env.ENCRYPTION_KEY, SERVER_AAD_MIN_VERSION, aadMeta),
      );

      const updated = yield* tryAsync(() =>
        ctx.db
          .update(items)
          .set({
            label: resolveStoredLabel(itemId, input.payload.label),
            serverCiphertext: encrypted.ciphertext,
            serverIv: encrypted.iv,
            serverKeyVersion: encrypted.keyVersion,
            contentVersion: item.contentVersion + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(items.id, itemId), eq(items.contentVersion, input.contentVersion)))
          .returning({ id: items.id }),
      );

      if (updated.length === 0) {
        return yield* Effect.fail(
          new ConflictError({
            code: "STALE_VERSION",
            message: "Stale version — reload and retry",
            hint: "Refresh the item details and retry the update with the latest contentVersion.",
          }),
        );
      }
    }

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      itemId,
      eventType: "item.update",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true, contentVersion: item.contentVersion + 1 };
  });

const ownerReveal = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const item = yield* loadOwnedItem(itemId, "item.export");

    if (item.storageMode !== "server_managed") {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          itemId,
          eventType: "item.export",
          reason: "zk_item_cannot_be_revealed",
          ipAddress: ctx.ipAddress,
        },
        new BadRequestError({
          code: "BAD_REQUEST",
          message: "Only server-managed items can be revealed via the API",
          hint: "Use local decryption for zero-knowledge items instead of the owner reveal API.",
        }),
      );
    }

    if (!item.serverCiphertext || !item.serverIv || item.serverKeyVersion == null) {
      return yield* Effect.fail(
        new BadRequestError({
          code: "BAD_REQUEST",
          message: "Item has no server-encrypted data",
          hint: "Check the item storage mode and stored ciphertext before retrying the reveal.",
        }),
      );
    }

    const ciphertext = item.serverCiphertext;
    const iv = item.serverIv;
    const keyVersion = item.serverKeyVersion;

    // v1 rows predate AAD binding and MUST be decrypted without AAD.
    // v2+ rows carry AAD bound to (orgId, profileId, itemId, keyVersion).
    const aadMeta: ServerAadMeta | undefined =
      keyVersion >= SERVER_AAD_MIN_VERSION
        ? {
            orgId: ctx.identity.organizationId,
            profileId: profileIdForServerAad(item.profileId),
            itemId: item.id,
            keyVersion,
          }
        : undefined;

    const decrypted = yield* tryAsync(() =>
      serverDecrypt({ ciphertext, iv, keyVersion }, ctx.env.ENCRYPTION_KEY, aadMeta),
    );

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      itemId,
      eventType: "item.export",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { exportFormat: "json" },
    });

    return { payload: decodeServerManagedPayload(item.id, decrypted) };
  });

const deleteItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    yield* loadOwnedItem(itemId, "item.delete");

    // Atomic: soft-delete the item, write the primary item.delete audit,
    // and run the cascade (delete permissions + one cascade audit row)
    // inside a single transaction. Prior shape ran these as three
    // sequential tryAsync steps; a mid-flight failure could leave the
    // item deleted but its permissions still active.
    const now = new Date();
    yield* tryAsync(() =>
      ctx.db.transaction(async (tx) => {
        await tx.update(items).set({ deletedAt: now }).where(eq(items.id, itemId));

        await tx.insert(auditLogs).values({
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          itemId,
          surface: "api",
          eventType: "item.delete",
          result: "allowed",
          ipAddress: ctx.ipAddress ?? null,
          meta: {},
        });

        await onItemDeleted(
          tx,
          itemId,
          ctx.identity.organizationId,
          ctx.identity.userId,
          ctx.ipAddress,
        );
      }),
    );

    return { ok: true };
  });

const ItemIdSchema = Schema.Struct({
  itemId: Schema.String.pipe(Schema.minLength(1)),
});

const UpdateItemInputEnvelopeSchema = Schema.Struct({
  itemId: Schema.String.pipe(Schema.minLength(1)),
  data: UpdateItemSchema,
});

export const itemsRouter = createTrpcRouter({
  create: scopedSessionProcedure("items:write")
    .input(strictSchema(CreateItemSchema))
    .output(strictSchema(IdResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createItem(input))),
  list: scopedSessionProcedure("items:read")
    .output(strictSchema(ItemListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listItems)),
  listForAgent: agentProcedure
    .output(strictSchema(ItemListResultSchema))
    .query(({ ctx }) => runAgentEffect(ctx, listItemsForAgent)),
  get: scopedSessionProcedure("items:read")
    .input(strictSchema(ItemIdSchema))
    .output(strictSchema(ItemResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getItem(input.itemId))),
  update: scopedSessionProcedure("items:write")
    .input(strictSchema(UpdateItemInputEnvelopeSchema))
    .output(strictSchema(ItemVersionResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, updateItem(input.itemId, input.data))),
  ownerReveal: scopedSessionProcedure("items:write")
    .input(strictSchema(ItemIdSchema))
    .output(strictSchema(RevealAccessResponseSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, ownerReveal(input.itemId))),
  delete: scopedSessionProcedure("items:write")
    .input(strictSchema(ItemIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, deleteItem(input.itemId))),
});
