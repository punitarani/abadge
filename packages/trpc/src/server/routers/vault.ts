/**
 * Legacy per-user vault router. Superseded by the org-scoped `profiles` router.
 *
 * Retained for web-app compatibility. Full removal is tracked under Phase C of
 * the v0 refactor. Full ZK-item coverage checks (equivalent to
 * `ROTATE_KEY_INCOMPLETE` in profiles.rotateKey) are intentionally NOT added
 * here -- "coverage" is a profile-centric invariant that does not map cleanly
 * onto this user-scoped model. This file tightens org-isolation only.
 */
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
import { and, eq } from "@abadge/db";
import { items, vaults } from "@abadge/db/schema";
import { Effect } from "effect";
import { logSessionAudit } from "../audit";
import { runSessionEffect, SessionRequestContextTag, strictSchema } from "../effect";
import { createTrpcRouter, scopedSessionProcedure } from "../init";
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
          hint: "Use the existing vault for this account instead of bootstrapping a second one.",
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
      organizationId: ctx.identity.organizationId,
      userId,
      eventType: "profile.create",
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
        hint: "Bootstrap the vault for this account before requesting vault metadata.",
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
          hint: "Bootstrap the vault before changing the password.",
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
      organizationId: ctx.identity.organizationId,
      userId,
      eventType: "profile.rotate",
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
          hint: "Bootstrap the vault before configuring a recovery key.",
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
          hint: "Bootstrap the vault before rotating keys.",
        }),
      );
    }

    const nextKeyVersion = vault.keyVersion + 1;
    yield* Effect.tryPromise(() =>
      ctx.db.transaction(async (tx) => {
        await tx
          .update(vaults)
          .set({
            wrappedRootKey: input.wrappedRootKey,
            recoveryWrappedRootKey: input.recoveryWrappedRootKey ?? vault.recoveryWrappedRootKey,
            keyVersion: nextKeyVersion,
            updatedAt: new Date(),
          })
          .where(eq(vaults.userId, userId));

        // Legacy vault.rotateKey: org-scope the update so a user authenticated in
        // one org cannot clobber items owned by the same user in another org.
        // Full coverage checks and removal of vault.* are tracked under Phase C.
        for (const r of input.rekeyedItems) {
          await tx
            .update(items)
            .set({
              encryptedItemKey: r.encryptedItemKey,
              keyNonce: r.keyNonce,
              cryptoVersion: nextKeyVersion,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(items.id, r.itemId),
                eq(items.userId, userId),
                eq(items.organizationId, ctx.identity.organizationId),
              ),
            );
        }
      }),
    );

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId,
      eventType: "profile.rotate",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { itemCount: input.rekeyedItems.length },
    });

    return { ok: true, keyVersion: nextKeyVersion };
  });

export const vaultRouter = createTrpcRouter({
  bootstrap: scopedSessionProcedure("vault:write")
    .input(strictSchema(VaultBootstrapSchema))
    .output(strictSchema(IdResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, bootstrapVault(input))),
  get: scopedSessionProcedure("vault:read")
    .output(strictSchema(VaultResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, getVault)),
  changePassword: scopedSessionProcedure("vault:write")
    .input(strictSchema(ChangePasswordSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, changePassword(input))),
  setupRecovery: scopedSessionProcedure("vault:write")
    .input(strictSchema(RecoverySetupSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, setupRecovery(input))),
  rotateKey: scopedSessionProcedure("vault:write")
    .input(strictSchema(RotateKeySchema))
    .output(strictSchema(KeyVersionResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, rotateKey(input))),
});
