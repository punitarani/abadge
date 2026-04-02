import {
  type ChangePasswordInput,
  ChangePasswordSchema,
  ConflictError,
  IdResultSchema,
  KeyVersionResultSchema,
  NotFoundError,
  type RecoverySetupInput,
  RecoverySetupSchema,
  type RotateKeyInput,
  RotateKeySchema,
  SuccessResultSchema,
  type VaultBootstrapInput,
  VaultBootstrapSchema,
  VaultResultSchema,
} from "@abadge/core";
import { eq } from "@abadge/db";
import { items, vaults } from "@abadge/db/schema";
import { Effect } from "effect";
import { logSessionAudit } from "../audit";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, sessionProcedure } from "../init";
import { serializeVault } from "../serialize";

const bootstrapVault = (input: VaultBootstrapInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;
    const [existing] = yield* Effect.tryPromise(() =>
      ctx.db.select({ id: vaults.id }).from(vaults).where(eq(vaults.userId, userId)).limit(1),
    );

    if (existing) {
      return yield* Effect.fail(
        new ConflictError({
          code: "VAULT_ALREADY_EXISTS",
          message: "Vault already exists",
        }),
      );
    }

    const id = crypto.randomUUID();
    yield* Effect.tryPromise(() =>
      ctx.db.insert(vaults).values({
        id,
        userId,
        wrappedRootKey: input.wrappedRootKey,
        kdfSalt: input.kdfSalt,
        kdfParams: input.kdfParams,
      }),
    );

    yield* logSessionAudit({
      userId,
      eventType: "vault.bootstrap",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { id };
  });

const getVault = Effect.gen(function* () {
  const ctx = yield* SessionRequestContextTag;
  const [vault] = yield* Effect.tryPromise(() =>
    ctx.db.select().from(vaults).where(eq(vaults.userId, ctx.identity.userId)).limit(1),
  );

  if (!vault) {
    return yield* Effect.fail(
      new NotFoundError({
        code: "VAULT_NOT_FOUND",
        message: "Vault not found",
      }),
    );
  }

  return { vault: serializeVault(vault) };
});

const changePassword = (input: ChangePasswordInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;
    const [vault] = yield* Effect.tryPromise(() =>
      ctx.db.select({ id: vaults.id }).from(vaults).where(eq(vaults.userId, userId)).limit(1),
    );

    if (!vault) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "VAULT_NOT_FOUND",
          message: "Vault not found",
        }),
      );
    }

    yield* Effect.tryPromise(() =>
      ctx.db
        .update(vaults)
        .set({
          wrappedRootKey: input.wrappedRootKey,
          kdfSalt: input.kdfSalt,
          kdfParams: input.kdfParams,
          updatedAt: new Date(),
        })
        .where(eq(vaults.userId, userId)),
    );

    yield* logSessionAudit({
      userId,
      eventType: "vault.password_change",
      result: "allowed",
      ipAddress: ctx.ipAddress,
    });

    return { ok: true };
  });

const setupRecovery = (input: RecoverySetupInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const [vault] = yield* Effect.tryPromise(() =>
      ctx.db
        .select({ id: vaults.id })
        .from(vaults)
        .where(eq(vaults.userId, ctx.identity.userId))
        .limit(1),
    );

    if (!vault) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "VAULT_NOT_FOUND",
          message: "Vault not found",
        }),
      );
    }

    yield* Effect.tryPromise(() =>
      ctx.db
        .update(vaults)
        .set({
          recoveryWrappedRootKey: input.recoveryWrappedRootKey,
          updatedAt: new Date(),
        })
        .where(eq(vaults.userId, ctx.identity.userId)),
    );

    return { ok: true };
  });

const rotateKey = (input: RotateKeyInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    const userId = ctx.identity.userId;
    const [vault] = yield* Effect.tryPromise(() =>
      ctx.db.select().from(vaults).where(eq(vaults.userId, userId)).limit(1),
    );

    if (!vault) {
      return yield* Effect.fail(
        new NotFoundError({
          code: "VAULT_NOT_FOUND",
          message: "Vault not found",
        }),
      );
    }

    const nextKeyVersion = vault.keyVersion + 1;
    yield* Effect.tryPromise(() =>
      ctx.db
        .update(vaults)
        .set({
          wrappedRootKey: input.wrappedRootKey,
          recoveryWrappedRootKey: input.recoveryWrappedRootKey ?? vault.recoveryWrappedRootKey,
          keyVersion: nextKeyVersion,
          updatedAt: new Date(),
        })
        .where(eq(vaults.userId, userId)),
    );

    for (const [itemId, newEncryptedItemKey] of Object.entries(input.rekeyedItems)) {
      yield* Effect.tryPromise(() =>
        ctx.db
          .update(items)
          .set({
            encryptedItemKey: newEncryptedItemKey,
            updatedAt: new Date(),
          })
          .where(eq(items.id, itemId)),
      );
    }

    yield* logSessionAudit({
      userId,
      eventType: "vault.key_rotate",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { itemCount: Object.keys(input.rekeyedItems).length },
    });

    return { ok: true, keyVersion: nextKeyVersion };
  });

export const vaultRouter = createTrpcRouter({
  bootstrap: sessionProcedure
    .input(strictSchema(VaultBootstrapSchema))
    .output(strictSchema(IdResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, bootstrapVault(input))),
  get: sessionProcedure
    .output(strictSchema(VaultResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, getVault)),
  changePassword: sessionProcedure
    .input(strictSchema(ChangePasswordSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, changePassword(input))),
  setupRecovery: sessionProcedure
    .input(strictSchema(RecoverySetupSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, setupRecovery(input))),
  rotateKey: sessionProcedure
    .input(strictSchema(RotateKeySchema))
    .output(strictSchema(KeyVersionResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, rotateKey(input))),
});
