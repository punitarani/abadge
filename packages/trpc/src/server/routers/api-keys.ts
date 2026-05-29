import {
  BadRequestError,
  type CreateUserApiKeyInput,
  CreateUserApiKeySchema,
  ForbiddenError,
  NotFoundError,
  SuccessResultSchema,
  USER_API_KEY_PREFIX,
  type UserApiKey,
  UserApiKeyListResultSchema,
  UserApiKeyWithSecretSchema,
} from "@abadge/core";
import { generateApiKey } from "@abadge/crypto/shared";
import { and, desc, eq, isNull } from "@abadge/db";
import { userApiKeys } from "@abadge/db/schema";
import { Effect, Schema } from "effect";
import { auditDeniedSession, logSessionAudit } from "../audit";
import type { SessionAuthMethod } from "../context";
import { runSessionEffect, SessionRequestContextTag, strictSchema, tryAsync } from "../effect";
import { createTrpcRouter, scopedSessionProcedure } from "../init";

type UserApiKeyRow = typeof userApiKeys.$inferSelect;

function serializeUserApiKey(row: UserApiKeyRow): UserApiKey {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    name: row.name,
    keyPrefix: row.secretPrefix,
    enabled: row.enabled,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A personal API key must not be able to mint or revoke other keys: that would
 * let a single leaked `abu_` token perpetuate account access with no human in
 * the loop. Key management requires a real browser/bearer session.
 */
function requireInteractiveSession(
  authMethod: SessionAuthMethod,
): Effect.Effect<void, ForbiddenError> {
  if (authMethod === "user_api_key") {
    return Effect.fail(
      new ForbiddenError({
        code: "FORBIDDEN",
        message: "API keys cannot manage other API keys",
        hint: "Sign in via the dashboard to create or revoke API keys.",
      }),
    );
  }
  return Effect.void;
}

const createUserApiKey = (input: CreateUserApiKeyInput) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    yield* requireInteractiveSession(ctx.identity.authMethod);

    const id = crypto.randomUUID();
    const { key, hash, prefix } = yield* tryAsync(() => generateApiKey(USER_API_KEY_PREFIX));
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
      return yield* Effect.fail(
        new BadRequestError({
          code: "BAD_REQUEST",
          message: "expiresAt must be a valid date in the future",
          hint: "Provide a future ISO 8601 datetime for expiresAt, or omit it for a non-expiring key.",
        }),
      );
    }

    yield* tryAsync(() =>
      ctx.db.insert(userApiKeys).values({
        id,
        userId: ctx.identity.userId,
        organizationId: ctx.identity.organizationId,
        name: input.name,
        secretHash: hash,
        secretPrefix: prefix,
        expiresAt,
      }),
    );

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      eventType: "user_api_key.create",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      // Never log the secret — only its prefix.
      meta: { keyId: id, keyPrefix: prefix },
    });

    return {
      apiKey: serializeUserApiKey({
        id,
        userId: ctx.identity.userId,
        organizationId: ctx.identity.organizationId,
        name: input.name,
        secretHash: hash,
        secretPrefix: prefix,
        enabled: true,
        revokedAt: null,
        expiresAt,
        lastUsedAt: null,
        metadata: {},
        createdAt: new Date(),
      }),
      key,
    };
  });

const listUserApiKeys = Effect.gen(function* () {
  const ctx = yield* SessionRequestContextTag;
  // Scope to (org, user): a caller only ever sees their own keys in this org.
  // Intentionally includes revoked and expired keys — the UI shows history for
  // audit; consumers can filter client-side on enabled/revokedAt.
  const rows = yield* tryAsync(() =>
    ctx.db
      .select()
      .from(userApiKeys)
      .where(
        and(
          eq(userApiKeys.organizationId, ctx.identity.organizationId),
          eq(userApiKeys.userId, ctx.identity.userId),
        ),
      )
      .orderBy(desc(userApiKeys.createdAt)),
  );

  return { apiKeys: rows.map(serializeUserApiKey) };
});

const revokeUserApiKey = (keyId: string) =>
  Effect.gen(function* () {
    const ctx = yield* SessionRequestContextTag;
    yield* requireInteractiveSession(ctx.identity.authMethod);

    const now = new Date();
    // Owner-scoped: (id, org, user) and not already revoked. The filters double
    // as the authorization check — a caller can't revoke another user's key.
    const updated = yield* tryAsync(() =>
      ctx.db
        .update(userApiKeys)
        .set({ revokedAt: now, enabled: false })
        .where(
          and(
            eq(userApiKeys.id, keyId),
            eq(userApiKeys.organizationId, ctx.identity.organizationId),
            eq(userApiKeys.userId, ctx.identity.userId),
            isNull(userApiKeys.revokedAt),
          ),
        )
        .returning({ id: userApiKeys.id }),
    );

    if (updated.length === 0) {
      return yield* auditDeniedSession(
        {
          organizationId: ctx.identity.organizationId,
          userId: ctx.identity.userId,
          eventType: "user_api_key.revoke",
          reason: "not_found",
          ipAddress: ctx.ipAddress,
          meta: { keyId },
        },
        new NotFoundError({
          code: "NOT_FOUND",
          message: "API key not found",
          hint: "Check the key ID; it may already be revoked or belong to another user.",
        }),
      );
    }

    yield* logSessionAudit({
      organizationId: ctx.identity.organizationId,
      userId: ctx.identity.userId,
      eventType: "user_api_key.revoke",
      result: "allowed",
      ipAddress: ctx.ipAddress,
      meta: { keyId },
    });

    return { ok: true };
  });

const ApiKeyIdSchema = Schema.Struct({
  keyId: Schema.String.pipe(Schema.minLength(1)),
});

export const apiKeysRouter = createTrpcRouter({
  create: scopedSessionProcedure("api_keys:write")
    .meta({ openapi: { method: "POST", path: "/api-keys", tags: ["api-keys"], protect: true } })
    .input(strictSchema(CreateUserApiKeySchema))
    .output(strictSchema(UserApiKeyWithSecretSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, createUserApiKey(input))),
  list: scopedSessionProcedure("api_keys:read")
    .meta({ openapi: { method: "GET", path: "/api-keys", tags: ["api-keys"], protect: true } })
    .output(strictSchema(UserApiKeyListResultSchema))
    .query(({ ctx }) => runSessionEffect(ctx, listUserApiKeys)),
  revoke: scopedSessionProcedure("api_keys:write")
    .meta({
      openapi: { method: "DELETE", path: "/api-keys/{keyId}", tags: ["api-keys"], protect: true },
    })
    .input(strictSchema(ApiKeyIdSchema))
    .output(strictSchema(SuccessResultSchema))
    .mutation(({ ctx, input }) => runSessionEffect(ctx, revokeUserApiKey(input.keyId))),
});
