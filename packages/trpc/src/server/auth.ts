import { UnauthorizedError } from "@abadge/core";
import { verifyApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull, or } from "@abadge/db";
import { principals } from "@abadge/db/schema";
import { Effect } from "effect";
import type { BaseRequestContext, PrincipalIdentity, SessionIdentity } from "./context";
import { tryAsync } from "./effect";

function getCandidatePrefixes(token: string): string[] {
  return [
    ...new Set(
      [token.slice(0, 8), token.slice(0, 6), token.slice(0, 4)].filter(
        (value): value is string => value.length > 0,
      ),
    ),
  ];
}

interface AuthSessionResult {
  session?: {
    userId?: string | null;
  } | null;
  user?: {
    id?: string | null;
  } | null;
}

interface AuthSessionLookupResult {
  session?: {
    userId?: string | null;
  } | null;
  user?: {
    id?: string | null;
  } | null;
}

interface AuthContextWithSessionLookup {
  internalAdapter: {
    findSession: (token: string) => Promise<AuthSessionLookupResult | null>;
  };
}

interface VerifyApiKeyResult {
  valid: boolean;
  key?: {
    id?: string;
    referenceId?: string;
  };
}

type ActivePrincipalCandidate = Pick<
  typeof principals.$inferSelect,
  "id" | "userId" | "locality" | "secretHash"
>;

type MigratedPrincipal = Pick<
  typeof principals.$inferSelect,
  "id" | "userId" | "locality" | "enabled" | "revokedAt"
>;

function unauthorized(message: string): UnauthorizedError {
  return new UnauthorizedError({
    code: "UNAUTHORIZED",
    message,
  });
}

function getBearerToken(ctx: BaseRequestContext): Effect.Effect<string, UnauthorizedError> {
  const authHeader = ctx.req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return Effect.succeed(authHeader.slice(7));
  }

  return Effect.fail(unauthorized("Missing Bearer token"));
}

function touchPrincipal(ctx: BaseRequestContext, principalId: string): void {
  void ctx.db
    .update(principals)
    .set({ lastUsedAt: new Date() })
    .where(eq(principals.id, principalId))
    .execute();
}

function toPrincipalIdentity(
  principal: Pick<typeof principals.$inferSelect, "id" | "userId" | "locality">,
): PrincipalIdentity {
  return {
    kind: "principal",
    principalId: principal.id,
    principalUserId: principal.userId,
    principalLocality: principal.locality,
  };
}

const verifyLocalPrincipalIdentity = (
  ctx: BaseRequestContext,
  token: string,
): Effect.Effect<PrincipalIdentity | null, Error> =>
  Effect.gen(function* () {
    const prefixes = getCandidatePrefixes(token);
    const activeCandidates = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: principals.id,
          userId: principals.userId,
          locality: principals.locality,
          secretHash: principals.secretHash,
        })
        .from(principals)
        .where(
          and(
            or(...prefixes.map((prefix) => eq(principals.secretPrefix, prefix))),
            eq(principals.enabled, true),
            isNull(principals.revokedAt),
          ),
        )
        .limit(10),
    )) as Array<ActivePrincipalCandidate>;

    for (const principal of activeCandidates) {
      const secretHash = principal.secretHash;
      if (!secretHash) {
        continue;
      }

      const valid = yield* tryAsync(() => verifyApiKey(token, secretHash));
      if (!valid) {
        continue;
      }

      touchPrincipal(ctx, principal.id);
      return toPrincipalIdentity(principal);
    }

    return null;
  });

const verifyLegacyPrincipalIdentity = (
  ctx: BaseRequestContext,
  token: string,
): Effect.Effect<PrincipalIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const result = (yield* tryAsync(() =>
      ctx.auth.api.verifyApiKey({
        body: { key: token },
      }),
    )) as VerifyApiKeyResult;

    if (!result.valid || !result.key) {
      return yield* Effect.fail(unauthorized("Invalid API key"));
    }

    const legacyPrincipalId = result.key.id;
    const legacyUserId = result.key.referenceId;
    if (!legacyPrincipalId || !legacyUserId) {
      return yield* Effect.fail(unauthorized("Invalid API key"));
    }

    const [migratedPrincipal] = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: principals.id,
          userId: principals.userId,
          locality: principals.locality,
          enabled: principals.enabled,
          revokedAt: principals.revokedAt,
        })
        .from(principals)
        .where(eq(principals.id, legacyPrincipalId))
        .limit(1),
    )) as Array<MigratedPrincipal>;

    if (migratedPrincipal && (!migratedPrincipal.enabled || migratedPrincipal.revokedAt)) {
      return yield* Effect.fail(unauthorized("Invalid API key"));
    }

    if (migratedPrincipal) {
      touchPrincipal(ctx, legacyPrincipalId);
      return toPrincipalIdentity(migratedPrincipal);
    }

    return {
      kind: "principal",
      principalId: legacyPrincipalId,
      principalUserId: legacyUserId,
      principalLocality: "remote",
    };
  });

export const resolveSessionIdentity = (
  ctx: BaseRequestContext,
): Effect.Effect<SessionIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const session = (yield* tryAsync(() =>
      ctx.auth.api.getSession({
        headers: ctx.req.headers,
      }),
    )) as AuthSessionResult | null;

    const sessionUserId = session?.user?.id ?? session?.session?.userId;
    if (sessionUserId) {
      return {
        kind: "session" as const,
        userId: sessionUserId,
      };
    }

    const bearerIdentity = yield* resolveBearerSessionIdentity(ctx);
    if (bearerIdentity) {
      return bearerIdentity;
    }

    return yield* Effect.fail(unauthorized("Unauthorized"));
  });

const resolveBearerSessionIdentity = (
  ctx: BaseRequestContext,
): Effect.Effect<SessionIdentity | null, Error> =>
  Effect.gen(function* () {
    const authHeader = ctx.req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }

    const token = authHeader.slice(7);
    const authContext = (yield* tryAsync(() => ctx.auth.$context)) as AuthContextWithSessionLookup;
    const sessionLookup = (yield* tryAsync(() =>
      authContext.internalAdapter.findSession(token),
    )) as AuthSessionLookupResult | null;

    const sessionUserId = sessionLookup?.user?.id ?? sessionLookup?.session?.userId;
    if (sessionUserId) {
      return {
        kind: "session" as const,
        userId: sessionUserId,
      };
    }

    const result = (yield* tryAsync(() =>
      ctx.auth.api.verifyApiKey({
        body: { key: token },
      }),
    )) as VerifyApiKeyResult;

    if (result.valid && result.key?.referenceId) {
      return {
        kind: "session" as const,
        userId: result.key.referenceId,
      };
    }

    return null;
  });

export const resolvePrincipalIdentity = (
  ctx: BaseRequestContext,
): Effect.Effect<PrincipalIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const token = yield* getBearerToken(ctx);
    const principalIdentity = yield* verifyLocalPrincipalIdentity(ctx, token);
    if (principalIdentity) {
      return principalIdentity;
    }

    return yield* verifyLegacyPrincipalIdentity(ctx, token);
  });
