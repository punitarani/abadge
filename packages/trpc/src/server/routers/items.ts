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
import { and, desc, eq, isNull, sql } from "@abadge/db";
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
import { cursorCondition, decodeCursor, nextCursorFrom, resolveLimit } from "../pagination";
import { type ScopedDb, scopedDb } from "../scoped-db";
import { serializeItemDetail, serializeItemSummary } from "../serialize";
import { decryptServerEnvelope, encryptServerEnvelope } from "../server-envelope";

const loadOwnedItem = (
  itemId: string,
  eventType: "item.read" | "item.update" | "item.export" | "item.delete",
) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    const [item] = yield* tryAsync(() =>
      scope.executor
        .select()
        .from(scope.tables.items)
        .where(
          and(
            eq(scope.tables.items.id, itemId),
            scope.orgScope("items"),
            isNull(scope.tables.items.deletedAt),
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
 * Resolves the target ZK profile (an explicit `opts.profileId` from §AB-0002
 * when given — already validated for org + mode by the caller — otherwise the
 * org's first ZK profile, legacy behavior), takes `pg_advisory_xact_lock` on
 * it, re-reads keyVersion (defending against a rotate that committed between
 * the profile SELECT and the lock acquisition), optionally enforces CAS via
 * expectedKeyVersion, then inserts with cryptoVersion tagged to the current
 * keyVersion. Designed to be called from inside `ctx.db.transaction(...)`.
 */
async function insertZeroKnowledgeItem(
  txScope: ScopedDb,
  opts: {
    id: string;
    userId: string;
    label: string;
    encryptedItemKey: string;
    ciphertext: string;
    expectedKeyVersion: number | undefined;
    // §AB-0002 — explicit target profile id; falls back to the org's first ZK
    // profile when undefined to preserve legacy single-profile behavior.
    profileId: string | undefined;
  },
): Promise<void> {
  const tx = txScope.executor;
  const profilesTable = txScope.tables.profiles;
  const [profile] = await tx
    .select({ id: profilesTable.id, keyVersion: profilesTable.keyVersion })
    .from(profilesTable)
    .where(
      and(
        txScope.orgScope("profiles"),
        eq(profilesTable.storageMode, "zero_knowledge"),
        ...(opts.profileId ? [eq(profilesTable.id, opts.profileId)] : []),
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
    .select({ keyVersion: profilesTable.keyVersion })
    .from(profilesTable)
    .where(eq(profilesTable.id, profile.id));

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

  await txScope.insert("items", {
    id: opts.id,
    createdBy: opts.userId,
    profileId: profile.id,
    label: opts.label,
    storageMode: "zero_knowledge",
    encryptedItemKey: opts.encryptedItemKey,
    ciphertext: opts.ciphertext,
    cryptoVersion: locked.keyVersion,
  });
}

/**
 * §AB-0001 / §AB-0002 — resolve the profile an item.create should target.
 *
 * With an explicit `profileId`: load it scoped to the caller's org and assert
 * it matches the item's storage mode (PROFILE_NOT_FOUND if it isn't in the org,
 * PROFILE_MODE_MISMATCH if the mode differs). Without one: pick the org's
 * default profile of that mode — preferring the auto-seeded `externalId='default'`
 * profile, then the oldest — so every server_managed item gets a real profileId
 * instead of being created profile-less and silently excluded from
 * profile-level grants.
 */
const resolveTargetProfile = (
  storageMode: "zero_knowledge" | "server_managed",
  explicitProfileId: string | undefined,
) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);

    if (explicitProfileId !== undefined) {
      const [profile] = yield* tryAsync(() =>
        scope.executor
          .select({ id: scope.tables.profiles.id, storageMode: scope.tables.profiles.storageMode })
          .from(scope.tables.profiles)
          .where(and(eq(scope.tables.profiles.id, explicitProfileId), scope.orgScope("profiles")))
          .limit(1),
      );
      if (!profile) {
        return yield* Effect.fail(
          new NotFoundError({
            code: "PROFILE_NOT_FOUND",
            message: "Profile not found",
            hint: "Confirm the profileId belongs to your organization.",
          }),
        );
      }
      if (profile.storageMode !== storageMode) {
        return yield* Effect.fail(
          new BadRequestError({
            code: "BAD_REQUEST",
            message: `Profile is ${profile.storageMode} but the item is ${storageMode}`,
            hint: `Target a ${storageMode} profile, or change the item's storageMode to match.`,
            meta: {
              reason: "profile_mode_mismatch",
              profileId: explicitProfileId,
              profileStorageMode: profile.storageMode,
              itemStorageMode: storageMode,
            },
          }),
        );
      }
      return profile.id;
    }

    const [profile] = yield* tryAsync(() =>
      scope.executor
        .select({ id: scope.tables.profiles.id })
        .from(scope.tables.profiles)
        .where(and(scope.orgScope("profiles"), eq(scope.tables.profiles.storageMode, storageMode)))
        .orderBy(
          sql`case when ${scope.tables.profiles.externalId} = 'default' then 0 else 1 end`,
          scope.tables.profiles.createdAt,
        )
        .limit(1),
    );
    if (!profile) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "PROFILE_NOT_FOUND",
          message: `No ${storageMode} profile found`,
          hint:
            storageMode === "zero_knowledge"
              ? "Create a zero-knowledge profile before storing ZK items."
              : "Create a server-managed profile before storing server-managed items.",
        }),
      );
    }
    return profile.id;
  });

const createItem = (input: CreateItemInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;

    // §W1S7-001 — ZK branch: client supplies `id` because it is bound into the
    // XChaCha20-Poly1305 AAD at encrypt time. Server-managed items still mint
    // the id here (the AAD for AES-GCM is derived server-side).
    const id = input.storageMode === "zero_knowledge" ? input.id : crypto.randomUUID();

    if (input.storageMode === "zero_knowledge") {
      // §AB-0002 — when the client targets an explicit profile, validate it
      // (org ownership + ZK mode) up front so callers get PROFILE_NOT_FOUND /
      // PROFILE_MODE_MISMATCH; default resolution + advisory lock stay inside
      // insertZeroKnowledgeItem.
      if (input.profileId !== undefined) {
        yield* resolveTargetProfile("zero_knowledge", input.profileId);
      }
      // tryAsync (not Effect.tryPromise) preserves the domain Error instance
      // thrown inside the tx callback, so toTrpcError's isDomainError check
      // maps ConflictError/NotFoundError to the correct tRPC code + cause.
      yield* tryAsync(() =>
        ctx.db.transaction((tx) =>
          insertZeroKnowledgeItem(scopedDb(tx, ctx.identity.organizationId), {
            id,
            userId,
            label: resolveStoredLabel(id, input.label),
            encryptedItemKey: input.encryptedItemKey,
            ciphertext: input.ciphertext,
            expectedKeyVersion: input.expectedKeyVersion,
            profileId: input.profileId,
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
      // §AB-0001 — bind the item to a real profile (the org's default
      // server_managed profile, or an explicit one per §AB-0002) so that
      // profile-level grants cover it (lookupPermission skips NULL-profile
      // rows) and the AAD is profile-scoped instead of the null sentinel.
      const targetProfileId = yield* resolveTargetProfile("server_managed", input.profileId);
      const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
      // §AB-0030 — encrypt under the profile's DEK (v3 envelope), provisioning
      // the DEK on first use. AAD still binds (orgId, profileId, itemId,
      // keyVersion) so a DB-write adversary can't substitute rows across items
      // or organizations.
      const encrypted = yield* tryAsync(() =>
        encryptServerEnvelope(
          ctx.db,
          ctx.env.ENCRYPTION_KEY,
          ctx.identity.organizationId,
          targetProfileId,
          id,
          plaintext,
        ),
      );

      const scope = scopedDb(ctx.db, ctx.identity.organizationId);
      yield* tryAsync(() =>
        scope.insert("items", {
          id,
          createdBy: userId,
          profileId: targetProfileId,
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

const ItemListQuerySchema = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.Int.pipe(Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(100)),
  ),
});

const listItems = (input: Schema.Schema.Type<typeof ItemListQuerySchema>) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    // §AB-0050 — keyset pagination over (createdAt DESC, id DESC): an immutable
    // tuple, so a concurrent insert never shifts an existing page.
    const limit = resolveLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const result = yield* tryAsync(() =>
      scope.executor
        .select({
          id: scope.tables.items.id,
          label: scope.tables.items.label,
          storageMode: scope.tables.items.storageMode,
          cryptoVersion: scope.tables.items.cryptoVersion,
          contentVersion: scope.tables.items.contentVersion,
          // §C2 — required so the web dashboard's profile-grant
          // blast-radius dialog can count items in a profile without
          // fetching item-detail rows for every item.
          profileId: scope.tables.items.profileId,
          createdAt: scope.tables.items.createdAt,
          updatedAt: scope.tables.items.updatedAt,
        })
        .from(scope.tables.items)
        .where(
          and(
            scope.orgScope("items"),
            isNull(scope.tables.items.deletedAt),
            cursorCondition(scope.tables.items.createdAt, scope.tables.items.id, cursor),
          ),
        )
        .orderBy(desc(scope.tables.items.createdAt), desc(scope.tables.items.id))
        .limit(limit),
    );

    return { items: result.map(serializeItemSummary), nextCursor: nextCursorFrom(result, limit) };
  });

const listItemsForAgent = (input: Schema.Schema.Type<typeof ItemListQuerySchema>) =>
  Effect.gen(function* () {
    const ctx = yield* AgentRequestContextTag;
    const scope = scopedDb(ctx.db, ctx.identity.agentOrganizationId);
    // §AB-0050 — the agent's grant set is not structurally bounded, so page it
    // on the same (createdAt DESC, id DESC) keyset as the session list.
    const limit = resolveLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const result = yield* tryAsync(() =>
      scope.executor
        .selectDistinct({
          id: scope.tables.items.id,
          label: scope.tables.items.label,
          storageMode: scope.tables.items.storageMode,
          cryptoVersion: scope.tables.items.cryptoVersion,
          contentVersion: scope.tables.items.contentVersion,
          profileId: scope.tables.items.profileId,
          createdAt: scope.tables.items.createdAt,
          updatedAt: scope.tables.items.updatedAt,
        })
        .from(scope.tables.items)
        .innerJoin(
          scope.tables.permissions,
          eq(scope.tables.permissions.itemId, scope.tables.items.id),
        )
        .where(
          and(
            scope.orgScope("items"),
            eq(scope.tables.permissions.agentId, ctx.identity.agentId),
            isNull(scope.tables.items.deletedAt),
            cursorCondition(scope.tables.items.createdAt, scope.tables.items.id, cursor),
          ),
        )
        .orderBy(desc(scope.tables.items.createdAt), desc(scope.tables.items.id))
        .limit(limit),
    );

    return { items: result.map(serializeItemSummary), nextCursor: nextCursorFrom(result, limit) };
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

    const scope = scopedDb(ctx.db, ctx.identity.organizationId);
    if (input.storageMode === "zero_knowledge") {
      const updated = yield* tryAsync(() =>
        scope.executor
          .update(scope.tables.items)
          .set({
            label: resolveStoredLabel(itemId, input.label),
            encryptedItemKey: input.encryptedItemKey,
            ciphertext: input.ciphertext,
            contentVersion: item.contentVersion + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(scope.tables.items.id, itemId),
              eq(scope.tables.items.contentVersion, input.contentVersion),
              scope.orgScope("items"),
            ),
          )
          .returning({ id: scope.tables.items.id }),
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
      // §AB-0030 — rewrite forward: v3 under the profile's DEK when the row has
      // a profile, else v2 (legacy NULL-profile rows stay decryptable).
      const encrypted = yield* tryAsync(() =>
        encryptServerEnvelope(
          ctx.db,
          ctx.env.ENCRYPTION_KEY,
          ctx.identity.organizationId,
          item.profileId,
          itemId,
          plaintext,
        ),
      );

      const updated = yield* tryAsync(() =>
        scope.executor
          .update(scope.tables.items)
          .set({
            label: resolveStoredLabel(itemId, input.payload.label),
            serverCiphertext: encrypted.ciphertext,
            serverIv: encrypted.iv,
            serverKeyVersion: encrypted.keyVersion,
            contentVersion: item.contentVersion + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(scope.tables.items.id, itemId),
              eq(scope.tables.items.contentVersion, input.contentVersion),
              scope.orgScope("items"),
            ),
          )
          .returning({ id: scope.tables.items.id }),
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

    // §AB-0030 — version-branched decrypt (v1/v2 master key, v3 per-profile DEK).
    const decrypted = yield* tryAsync(() =>
      decryptServerEnvelope(ctx.db, ctx.env.ENCRYPTION_KEY, ctx.identity.organizationId, {
        id: item.id,
        profileId: item.profileId,
        serverCiphertext: item.serverCiphertext,
        serverIv: item.serverIv,
        serverKeyVersion: item.serverKeyVersion,
      }),
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
        const txScope = scopedDb(tx, ctx.identity.organizationId);
        await tx
          .update(txScope.tables.items)
          .set({ deletedAt: now })
          .where(and(eq(txScope.tables.items.id, itemId), txScope.orgScope("items")));

        await txScope.insert("auditLogs", {
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
    .meta({ openapi: { method: "POST", path: "/items", tags: ["items"], protect: true } })
    .input(strictSchema(CreateItemSchema))
    .output(strictSchema(IdResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createItem(input))),
  list: scopedSessionProcedure("items:read")
    .meta({ openapi: { method: "GET", path: "/items", tags: ["items"], protect: true } })
    // §AB-0050 — input is optional so existing no-arg `list()` callers keep
    // working (first page); pagination params are opt-in.
    .input(strictSchema(Schema.UndefinedOr(ItemListQuerySchema)))
    .output(strictSchema(ItemListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, listItems(input ?? {}))),
  listForAgent: agentProcedure
    .input(strictSchema(Schema.UndefinedOr(ItemListQuerySchema)))
    .output(strictSchema(ItemListResultSchema))
    .query(({ ctx, input }) => runAgentEffect(ctx, listItemsForAgent(input ?? {}))),
  get: scopedSessionProcedure("items:read")
    .meta({
      openapi: { method: "GET", path: "/items/{itemId}", tags: ["items"], protect: true },
    })
    .input(strictSchema(ItemIdSchema))
    .output(strictSchema(ItemResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getItem(input.itemId))),
  update: scopedSessionProcedure("items:write")
    .meta({
      openapi: { method: "PATCH", path: "/items/{itemId}", tags: ["items"], protect: true },
    })
    .input(strictSchema(UpdateItemInputEnvelopeSchema))
    .output(strictSchema(ItemVersionResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, updateItem(input.itemId, input.data))),
  ownerReveal: scopedSessionProcedure("items:write")
    .input(strictSchema(ItemIdSchema))
    .output(strictSchema(RevealAccessResponseSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, ownerReveal(input.itemId))),
  delete: scopedSessionProcedure("items:write")
    .meta({
      openapi: { method: "DELETE", path: "/items/{itemId}", tags: ["items"], protect: true },
    })
    .input(strictSchema(ItemIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, deleteItem(input.itemId))),
});
