import {
  ConflictError,
  type CreateItemInput,
  CreateItemSchema,
  IdResultSchema,
  ItemDisplayListResultSchema,
  type ItemDisplayQuery,
  ItemDisplayQuerySchema,
  ItemListResultSchema,
  ItemResultSchema,
  ItemVersionResultSchema,
  NotFoundError,
  SuccessResultSchema,
  type UpdateItemInput,
  UpdateItemSchema,
} from "@abadge/core";
import { serverDecrypt, serverEncrypt } from "@abadge/crypto/server";
import { and, desc, eq, inArray, isNull } from "@abadge/db";
import { items, vaults } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { logSessionAudit } from "../audit";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, sessionProcedure } from "../init";
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
          and(eq(items.id, itemId), eq(items.userId, ctx.identity.userId), isNull(items.deletedAt)),
        )
        .limit(1),
    );

    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
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
      const [vault] = yield* Effect.tryPromise(() =>
        ctx.db.select({ id: vaults.id }).from(vaults).where(eq(vaults.userId, userId)).limit(1),
      );

      if (!vault) {
        return yield* Effect.fail(
          new NotFoundError({
            code: "VAULT_NOT_FOUND",
            message: "Vault not bootstrapped",
          }),
        );
      }

      yield* Effect.tryPromise(() =>
        ctx.db.insert(items).values({
          id,
          userId,
          vaultId: vault.id,
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
          storageMode: "server_managed",
          serverCiphertext: encrypted.ciphertext,
          serverIv: encrypted.iv,
          serverKeyVersion: encrypted.keyVersion,
        }),
      );
    }

    yield* logSessionAudit({
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
        storageMode: items.storageMode,
        cryptoVersion: items.cryptoVersion,
        contentVersion: items.contentVersion,
        createdAt: items.createdAt,
        updatedAt: items.updatedAt,
      })
      .from(items)
      .where(and(eq(items.userId, ctx.identity.userId), isNull(items.deletedAt)))
      .orderBy(desc(items.createdAt)),
  );

  return { items: result.map(serializeItemSummary) };
});

export const resolveItemDisplay = (input: ItemDisplayQuery) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const itemIds = [...new Set(input.itemIds)];

    if (itemIds.length === 0) {
      return { items: [] };
    }

    const result = yield* Effect.tryPromise(() =>
      ctx.db
        .select({
          id: items.id,
          storageMode: items.storageMode,
          encryptedItemKey: items.encryptedItemKey,
          ciphertext: items.ciphertext,
          serverCiphertext: items.serverCiphertext,
          serverIv: items.serverIv,
          serverKeyVersion: items.serverKeyVersion,
        })
        .from(items)
        .where(
          and(
            eq(items.userId, ctx.identity.userId),
            isNull(items.deletedAt),
            inArray(items.id, itemIds),
          ),
        ),
    );

    const displayItems = yield* Effect.tryPromise(() =>
      Promise.all(
        result.map(async (item) => {
          try {
            if (item.storageMode === "server_managed") {
              if (!item.serverCiphertext || !item.serverIv || item.serverKeyVersion == null) {
                return null;
              }

              const decrypted = await serverDecrypt(
                {
                  ciphertext: item.serverCiphertext,
                  iv: item.serverIv,
                  keyVersion: item.serverKeyVersion,
                },
                ctx.env.ENCRYPTION_KEY,
              );

              return {
                itemId: item.id,
                storageMode: "server_managed" as const,
                label: decodeServerManagedPayload(item.id, decrypted).label,
              };
            }

            if (!item.encryptedItemKey || !item.ciphertext) {
              return null;
            }

            return {
              itemId: item.id,
              storageMode: "zero_knowledge" as const,
              encryptedItemKey: item.encryptedItemKey,
              ciphertext: item.ciphertext,
            };
          } catch {
            return null;
          }
        }),
      ),
    );

    return {
      items: displayItems.filter((item): item is NonNullable<typeof item> => item !== null),
    };
  });

const getItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const item = yield* loadOwnedItem(itemId);

    yield* logSessionAudit({
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

    if (item.contentVersion !== input.contentVersion) {
      return yield* Effect.fail(
        new ConflictError({
          code: "STALE_VERSION",
          message: "Stale version — reload and retry",
        }),
      );
    }

    if (input.storageMode === "zero_knowledge") {
      yield* Effect.tryPromise(() =>
        ctx.db
          .update(items)
          .set({
            encryptedItemKey: input.encryptedItemKey,
            ciphertext: input.ciphertext,
            contentVersion: item.contentVersion + 1,
            updatedAt: new Date(),
          })
          .where(eq(items.id, itemId)),
      );
    } else {
      const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
      const encrypted = yield* Effect.tryPromise(() =>
        serverEncrypt(plaintext, ctx.env.ENCRYPTION_KEY, 1),
      );

      yield* Effect.tryPromise(() =>
        ctx.db
          .update(items)
          .set({
            serverCiphertext: encrypted.ciphertext,
            serverIv: encrypted.iv,
            serverKeyVersion: encrypted.keyVersion,
            contentVersion: item.contentVersion + 1,
            updatedAt: new Date(),
          })
          .where(eq(items.id, itemId)),
      );
    }

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      itemId,
      eventType: "item.update",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true, contentVersion: item.contentVersion + 1 };
  });

const deleteItem = (itemId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    yield* loadOwnedItem(itemId);

    yield* Effect.tryPromise(() =>
      ctx.db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, itemId)),
    );

    yield* logSessionAudit({
      userId: ctx.identity.userId,
      itemId,
      eventType: "item.delete",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

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
  create: sessionProcedure
    .input(strictSchema(CreateItemSchema))
    .output(strictSchema(IdResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createItem(input))),
  list: sessionProcedure
    .output(strictSchema(ItemListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listItems)),
  resolveDisplay: sessionProcedure
    .input(strictSchema(ItemDisplayQuerySchema))
    .output(strictSchema(ItemDisplayListResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, resolveItemDisplay(input))),
  get: sessionProcedure
    .input(strictSchema(ItemIdSchema))
    .output(strictSchema(ItemResultSchema))
    .query(({ ctx, input }) => runSessionEffect(ctx, getItem(input.itemId))),
  update: sessionProcedure
    .input(strictSchema(UpdateItemInputEnvelopeSchema))
    .output(strictSchema(ItemVersionResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, updateItem(input.itemId, input.data))),
  delete: sessionProcedure
    .input(strictSchema(ItemIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, deleteItem(input.itemId))),
});
