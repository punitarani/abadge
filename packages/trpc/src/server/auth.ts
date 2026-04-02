import { UnauthorizedError } from "@abadge/core";
import { verifyApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull, or } from "@abadge/db";
import { principals as agentRecords } from "@abadge/db/schema";
import { Effect } from "effect";
import type { AgentIdentity, BaseRequestContext, SessionIdentity } from "./context";
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

type ActiveAgentCandidate = Pick<
  typeof agentRecords.$inferSelect,
  "id" | "userId" | "locality" | "secretHash"
>;

type MigratedAgent = Pick<
  typeof agentRecords.$inferSelect,
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

function touchAgent(ctx: BaseRequestContext, agentId: string): void {
  void ctx.db
    .update(agentRecords)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentRecords.id, agentId))
    .execute();
}

function toAgentIdentity(
  agent: Pick<typeof agentRecords.$inferSelect, "id" | "userId" | "locality">,
): AgentIdentity {
  return {
    kind: "agent",
    agentId: agent.id,
    agentUserId: agent.userId,
    agentLocality: agent.locality,
  };
}

const verifyLocalAgentIdentity = (
  ctx: BaseRequestContext,
  token: string,
): Effect.Effect<AgentIdentity | null, Error> =>
  Effect.gen(function* () {
    const prefixes = getCandidatePrefixes(token);
    const activeCandidates = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: agentRecords.id,
          userId: agentRecords.userId,
          locality: agentRecords.locality,
          secretHash: agentRecords.secretHash,
        })
        .from(agentRecords)
        .where(
          and(
            or(...prefixes.map((prefix) => eq(agentRecords.secretPrefix, prefix))),
            eq(agentRecords.enabled, true),
            isNull(agentRecords.revokedAt),
          ),
        )
        .limit(10),
    )) as Array<ActiveAgentCandidate>;

    for (const agent of activeCandidates) {
      const secretHash = agent.secretHash;
      if (!secretHash) {
        continue;
      }

      const valid = yield* tryAsync(() => verifyApiKey(token, secretHash));
      if (!valid) {
        continue;
      }

      touchAgent(ctx, agent.id);
      return toAgentIdentity(agent);
    }

    return null;
  });

const verifyLegacyAgentIdentity = (
  ctx: BaseRequestContext,
  token: string,
): Effect.Effect<AgentIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const result = (yield* tryAsync(() =>
      ctx.auth.api.verifyApiKey({
        body: { key: token },
      }),
    )) as VerifyApiKeyResult;

    if (!result.valid || !result.key) {
      return yield* Effect.fail(unauthorized("Invalid API key"));
    }

    const legacyAgentId = result.key.id;
    const legacyUserId = result.key.referenceId;
    if (!legacyAgentId || !legacyUserId) {
      return yield* Effect.fail(unauthorized("Invalid API key"));
    }

    const [migratedAgent] = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: agentRecords.id,
          userId: agentRecords.userId,
          locality: agentRecords.locality,
          enabled: agentRecords.enabled,
          revokedAt: agentRecords.revokedAt,
        })
        .from(agentRecords)
        .where(eq(agentRecords.id, legacyAgentId))
        .limit(1),
    )) as Array<MigratedAgent>;

    if (migratedAgent && (!migratedAgent.enabled || migratedAgent.revokedAt)) {
      return yield* Effect.fail(unauthorized("Invalid API key"));
    }

    if (migratedAgent) {
      touchAgent(ctx, legacyAgentId);
      return toAgentIdentity(migratedAgent);
    }

    return {
      kind: "agent",
      agentId: legacyAgentId,
      agentUserId: legacyUserId,
      agentLocality: "remote",
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

    return null;
  });

export const resolveAgentIdentity = (
  ctx: BaseRequestContext,
): Effect.Effect<AgentIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const token = yield* getBearerToken(ctx);
    const agentIdentity = yield* verifyLocalAgentIdentity(ctx, token);
    if (agentIdentity) {
      return agentIdentity;
    }

    return yield* verifyLegacyAgentIdentity(ctx, token);
  });
