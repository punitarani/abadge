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
import { and, desc, eq, isNull } from "@abadge/db";
import { items, profiles } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import { onItemDeleted } from "../cascades";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, scopedSessionProcedure } from "../init";
import { resolveStoredLabel } from "../item-labels";
import { decodeServerManagedPayload } from "../item-payload";
import { serializeItemDetail, serializeItemSummary } from "../serialize";

const loadOwnedItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [item] = yield* Effect.tryPromise(() =>
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
      return yield* Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
          hint: "Check the item ID and make sure the item still exists for this account.",
        }),
      );
    }

    return item;
  });

const createItem = (input: CreateItemInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;
    const id = crypto.randomUUID();

    if (input.storageMode === "zero_knowledge") {
      const [profile] = yield* Effect.tryPromise(() =>
        ctx.db
          .select({ id: profiles.id })
          .from(profiles)
          .where(
            and(
              eq(profiles.organizationId, ctx.identity.organizationId),
              eq(profiles.storageMode, "zero_knowledge"),
            ),
          )
          .limit(1),
      );

      if (!profile) {
        return yield* Effect.fail(
          new NotFoundError({
            code: "NOT_FOUND",
            message: "No zero-knowledge profile found",
            hint: "Create a ZK profile first or use server-managed storage mode.",
          }),
        );
      }

      yield* Effect.tryPromise(() =>
        ctx.db.insert(items).values({
          id,
          userId,
          organizationId: ctx.identity.organizationId,
          profileId: profile.id,
          label: resolveStoredLabel(id, input.label),
          storageMode: "zero_knowledge",
          encryptedItemKey: input.encryptedItemKey,
          ciphertext: input.ciphertext,
        }),
      );
    } else {
      const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
      const encrypted = yield* Effect.tryPromise(() =>
        serverEncrypt(plaintext, ctx.env.ENCRYPTION_KEY, 1),
      );

      yield* Effect.tryPromise(() =>
        ctx.db.insert(items).values({
          id,
          userId,
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
  const result = yield* Effect.tryPromise(() =>
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

const getItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const item = yield* loadOwnedItem(itemId);

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
    const item = yield* loadOwnedItem(itemId);

    if (input.storageMode === "zero_knowledge") {
      const updated = yield* Effect.tryPromise(() =>
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
      const encrypted = yield* Effect.tryPromise(() =>
        serverEncrypt(plaintext, ctx.env.ENCRYPTION_KEY, 1),
      );

      const updated = yield* Effect.tryPromise(() =>
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
    const item = yield* loadOwnedItem(itemId);

    if (item.storageMode !== "server_managed") {
      return yield* Effect.fail(
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

    const decrypted = yield* Effect.tryPromise(() =>
      serverDecrypt({ ciphertext, iv, keyVersion }, ctx.env.ENCRYPTION_KEY),
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
    yield* loadOwnedItem(itemId);

    yield* Effect.tryPromise(() =>
      ctx.db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, itemId)),
    );

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      itemId,
      eventType: "item.delete",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    yield* Effect.tryPromise(() =>
      onItemDeleted(
        ctx.db,
        itemId,
        ctx.identity.organizationId,
        ctx.identity.userId,
        ctx.ipAddress,
      ),
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
