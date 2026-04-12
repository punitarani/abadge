import { AGENT_SESSION_PREFIX, UnauthorizedError } from "@abadge/core";
import { hashApiKey, verifyApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull, or } from "@abadge/db";
import {
  principals as agentRecords,
  agentSessions,
  auditLog,
  operatorTokens,
} from "@abadge/db/schema";
import { Effect } from "effect";
import type { AgentIdentity, BaseRequestContext, SessionIdentity } from "./context";
import { tryAsync } from "./effect";
import { OPERATOR_TOKEN_PREFIX } from "./operator-token";

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
  "id" | "userId" | "locality" | "authMethod" | "secretHash"
>;

type MigratedAgent = Pick<
  typeof agentRecords.$inferSelect,
  "id" | "userId" | "locality" | "enabled" | "revokedAt"
>;

type ActiveAgentSession = Pick<
  typeof agentSessions.$inferSelect,
  "id" | "agentId" | "userId" | "expiresAt"
>;

type AgentSessionAgentCandidate = Pick<
  typeof agentRecords.$inferSelect,
  "id" | "userId" | "locality" | "enabled" | "revokedAt"
>;

type ActiveOperatorToken = Pick<
  typeof operatorTokens.$inferSelect,
  "id" | "userId" | "scopes" | "expiresAt"
>;

function unauthorized(message: string): UnauthorizedError {
  return new UnauthorizedError({
    code: "UNAUTHORIZED",
    message,
    hint: "Authenticate with a valid session token, agent API key, or short-lived agent session token.",
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

function touchAgentSession(ctx: BaseRequestContext, sessionId: string): void {
  void ctx.db
    .update(agentSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentSessions.id, sessionId))
    .execute();
}

function touchOperatorToken(ctx: BaseRequestContext, tokenId: string): void {
  void ctx.db
    .update(operatorTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(operatorTokens.id, tokenId))
    .execute();
}

function auditAgentSessionReject(
  ctx: BaseRequestContext,
  input: {
    userId: string;
    agentId: string;
    result: "denied" | "expired" | "revoked";
    reason: string;
  },
): Effect.Effect<void, Error> {
  return tryAsync(() =>
    ctx.db
      .insert(auditLog)
      .values({
        userId: input.userId,
        principalId: input.agentId,
        eventType: "agent.session_reject",
        result: input.result,
        meta: { reason: input.reason },
        ipAddress: ctx.ipAddress ?? null,
      })
      .then(() => undefined),
  );
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
          authMethod: agentRecords.authMethod,
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
      if (agent.authMethod !== "legacy_api_key") {
        continue;
      }

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

const verifyAgentSessionIdentity = (
  ctx: BaseRequestContext,
  token: string,
): Effect.Effect<AgentIdentity | null, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    if (!token.startsWith(AGENT_SESSION_PREFIX)) {
      return null;
    }

    const tokenHash = yield* tryAsync(() => hashApiKey(token));
    const [sessionRecord] = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: agentSessions.id,
          agentId: agentSessions.agentId,
          userId: agentSessions.userId,
          expiresAt: agentSessions.expiresAt,
        })
        .from(agentSessions)
        .where(and(eq(agentSessions.tokenHash, tokenHash), isNull(agentSessions.revokedAt)))
        .limit(1),
    )) as Array<ActiveAgentSession>;

    if (!sessionRecord) {
      return yield* Effect.fail(unauthorized("Invalid agent session"));
    }

    if (sessionRecord.expiresAt <= new Date()) {
      yield* auditAgentSessionReject(ctx, {
        userId: sessionRecord.userId,
        agentId: sessionRecord.agentId,
        result: "expired",
        reason: "session_expired",
      });
      return yield* Effect.fail(unauthorized("Expired agent session"));
    }

    const [agent] = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: agentRecords.id,
          userId: agentRecords.userId,
          locality: agentRecords.locality,
          enabled: agentRecords.enabled,
          revokedAt: agentRecords.revokedAt,
        })
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, sessionRecord.agentId),
            eq(agentRecords.userId, sessionRecord.userId),
          ),
        )
        .limit(1),
    )) as Array<AgentSessionAgentCandidate>;

    if (!agent) {
      yield* auditAgentSessionReject(ctx, {
        userId: sessionRecord.userId,
        agentId: sessionRecord.agentId,
        result: "denied",
        reason: "session_agent_not_found",
      });
      return yield* Effect.fail(unauthorized("Invalid agent session"));
    }

    if (!agent.enabled) {
      yield* auditAgentSessionReject(ctx, {
        userId: agent.userId,
        agentId: agent.id,
        result: "denied",
        reason: "session_agent_disabled",
      });
      return yield* Effect.fail(unauthorized("Invalid agent session"));
    }

    if (agent.revokedAt) {
      yield* auditAgentSessionReject(ctx, {
        userId: agent.userId,
        agentId: agent.id,
        result: "revoked",
        reason: "session_agent_revoked",
      });
      return yield* Effect.fail(unauthorized("Invalid agent session"));
    }

    touchAgent(ctx, agent.id);
    touchAgentSession(ctx, sessionRecord.id);
    return toAgentIdentity(agent);
  });

export const resolveSessionIdentity = (
  ctx: BaseRequestContext,
): Effect.Effect<SessionIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const operatorTokenIdentity = yield* resolveOperatorTokenIdentity(ctx);
    if (operatorTokenIdentity) {
      return operatorTokenIdentity;
    }

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
        authMethod: "browser_session",
      };
    }

    const bearerIdentity = yield* resolveBearerSessionIdentity(ctx);
    if (bearerIdentity) {
      return bearerIdentity;
    }

    return yield* Effect.fail(unauthorized("Unauthorized"));
  });

const resolveOperatorTokenIdentity = (
  ctx: BaseRequestContext,
): Effect.Effect<SessionIdentity | null, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const token = ctx.req.headers.get("X-Abadge-Operator-Token");
    if (!token) {
      return null;
    }

    if (!token.startsWith(OPERATOR_TOKEN_PREFIX)) {
      return yield* Effect.fail(unauthorized("Invalid operator token"));
    }

    const tokenHash = yield* tryAsync(() => hashApiKey(token));
    const [record] = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: operatorTokens.id,
          userId: operatorTokens.userId,
          scopes: operatorTokens.scopes,
          expiresAt: operatorTokens.expiresAt,
        })
        .from(operatorTokens)
        .where(and(eq(operatorTokens.tokenHash, tokenHash), isNull(operatorTokens.revokedAt)))
        .limit(1),
    )) as Array<ActiveOperatorToken>;

    if (!record) {
      return yield* Effect.fail(unauthorized("Invalid operator token"));
    }

    if (record.expiresAt <= new Date()) {
      return yield* Effect.fail(unauthorized("Expired operator token"));
    }

    touchOperatorToken(ctx, record.id);
    return {
      kind: "session" as const,
      userId: record.userId,
      authMethod: "operator_token",
      operatorTokenId: record.id,
      scopes: record.scopes,
    };
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
        authMethod: "bearer_session",
      };
    }

    return null;
  });

export const resolveAgentIdentity = (
  ctx: BaseRequestContext,
): Effect.Effect<AgentIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const token = yield* getBearerToken(ctx);
    const sessionIdentity = yield* verifyAgentSessionIdentity(ctx, token);
    if (sessionIdentity) {
      return sessionIdentity;
    }

    const agentIdentity = yield* verifyLocalAgentIdentity(ctx, token);
    if (agentIdentity) {
      return agentIdentity;
    }

    return yield* verifyLegacyAgentIdentity(ctx, token);
  });
