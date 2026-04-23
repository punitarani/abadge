import {
  AGENT_SESSION_PREFIX,
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from "@abadge/core";
import { hashApiKey, verifyApiKey } from "@abadge/crypto/shared";
import { and, asc, eq, isNull, or } from "@abadge/db";
import { agents as agentRecords, agentSessions, auditLogs, member } from "@abadge/db/schema";
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

export interface AuthSessionResult {
  session?: {
    userId?: string | null;
  } | null;
  user?: {
    id?: string | null;
  } | null;
}

interface AuthContextWithSessionLookup {
  internalAdapter: {
    findSession: (token: string) => Promise<AuthSessionResult | null>;
  };
}

type ActiveAgentCandidate = Pick<
  typeof agentRecords.$inferSelect,
  "id" | "organizationId" | "createdBy" | "locality" | "authMethod" | "secretHash"
>;

type ActiveAgentSession = Pick<
  typeof agentSessions.$inferSelect,
  "id" | "agentId" | "userId" | "expiresAt"
>;

type AgentSessionAgentCandidate = Pick<
  typeof agentRecords.$inferSelect,
  "id" | "organizationId" | "createdBy" | "locality" | "enabled" | "revokedAt"
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
    .execute()
    .catch(() => {});
}

function toAgentIdentity(
  agent: Pick<typeof agentRecords.$inferSelect, "id" | "organizationId" | "createdBy" | "locality">,
): AgentIdentity {
  return {
    kind: "agent",
    agentId: agent.id,
    agentUserId: agent.createdBy,
    agentOrganizationId: agent.organizationId,
    agentLocality: agent.locality,
  };
}

function touchAgentSession(ctx: BaseRequestContext, sessionId: string): void {
  void ctx.db
    .update(agentSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentSessions.id, sessionId))
    .execute()
    .catch(() => {});
}

function auditAgentSessionReject(
  ctx: BaseRequestContext,
  input: {
    userId: string;
    agentId: string;
    organizationId: string;
    result: "denied" | "expired" | "revoked";
    reason: string;
  },
): Effect.Effect<void, Error> {
  return tryAsync(() =>
    ctx.db
      .insert(auditLogs)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        agentId: input.agentId,
        eventType: "agent.session_reject",
        result: input.result,
        meta: { reason: input.reason },
        ipAddress: ctx.ipAddress ?? null,
      })
      .then(() => undefined),
  );
}

// Rate-limit audit writes for unrecognized bearers to prevent attacker-driven
// audit-log amplification. 1 write per IP per 10s window.
const UNAUTH_AUDIT_WINDOW_MS = 10_000;
const unauthBearerAuditCounters = new Map<string, { resetAt: number }>();

export function shouldWriteUnauthBearerAudit(ipAddress: string | undefined): boolean {
  const key = ipAddress ?? "__unknown_ip__";
  const now = Date.now();
  const entry = unauthBearerAuditCounters.get(key);
  if (!entry || entry.resetAt < now) {
    unauthBearerAuditCounters.set(key, { resetAt: now + UNAUTH_AUDIT_WINDOW_MS });
    return true;
  }
  return false;
}

function auditUnrecognizedBearer(
  ctx: BaseRequestContext,
  token: string,
): Effect.Effect<void, never> {
  if (!shouldWriteUnauthBearerAudit(ctx.ipAddress)) {
    return Effect.void;
  }
  return tryAsync(() =>
    ctx.db
      .insert(auditLogs)
      .values({
        organizationId: "__unauth__",
        userId: "__unauth__",
        agentId: null,
        eventType: "agent.session_reject",
        result: "denied",
        // Short prefix only — never log the full token bytes.
        meta: { reason: "unknown_credential", tokenPrefix: token.slice(0, 4) },
        ipAddress: ctx.ipAddress ?? null,
      })
      .then(() => undefined),
  ).pipe(
    // Audit-write failures must never invert the underlying auth-fail response.
    Effect.catchAll((err) => {
      console.warn(
        `audit_write_failed (unauth_bearer) err=${err instanceof Error ? err.message : String(err)}`,
      );
      return Effect.void;
    }),
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
          organizationId: agentRecords.organizationId,
          createdBy: agentRecords.createdBy,
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

const verifyAgentSessionIdentity = (
  ctx: BaseRequestContext,
  token: string,
): Effect.Effect<AgentIdentity | null, Error> =>
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
      // Fall through to verifyLocalAgentIdentity and the unrecognized-bearer audit path.
      // Throwing here would short-circuit the audit for abs_-prefixed probes.
      return null;
    }

    if (sessionRecord.expiresAt <= new Date()) {
      const [expiredAgent] = (yield* tryAsync(() =>
        ctx.db
          .select({ organizationId: agentRecords.organizationId })
          .from(agentRecords)
          .where(eq(agentRecords.id, sessionRecord.agentId))
          .limit(1),
      )) as Array<{ organizationId: string }>;
      yield* auditAgentSessionReject(ctx, {
        userId: sessionRecord.userId,
        agentId: sessionRecord.agentId,
        organizationId: expiredAgent?.organizationId ?? "",
        result: "expired",
        reason: "session_expired",
      });
      return yield* Effect.fail(unauthorized("Expired agent session"));
    }

    const [agent] = (yield* tryAsync(() =>
      ctx.db
        .select({
          id: agentRecords.id,
          organizationId: agentRecords.organizationId,
          createdBy: agentRecords.createdBy,
          locality: agentRecords.locality,
          enabled: agentRecords.enabled,
          revokedAt: agentRecords.revokedAt,
        })
        .from(agentRecords)
        .where(
          and(
            eq(agentRecords.id, sessionRecord.agentId),
            eq(agentRecords.createdBy, sessionRecord.userId),
          ),
        )
        .limit(1),
    )) as Array<AgentSessionAgentCandidate>;

    if (!agent) {
      yield* auditAgentSessionReject(ctx, {
        userId: sessionRecord.userId,
        agentId: sessionRecord.agentId,
        organizationId: "",
        result: "denied",
        reason: "session_agent_not_found",
      });
      return yield* Effect.fail(unauthorized("Invalid agent session"));
    }

    if (!agent.enabled) {
      yield* auditAgentSessionReject(ctx, {
        userId: agent.createdBy,
        agentId: agent.id,
        organizationId: agent.organizationId,
        result: "denied",
        reason: "session_agent_disabled",
      });
      return yield* Effect.fail(unauthorized("Invalid agent session"));
    }

    if (agent.revokedAt) {
      yield* auditAgentSessionReject(ctx, {
        userId: agent.createdBy,
        agentId: agent.id,
        organizationId: agent.organizationId,
        result: "revoked",
        reason: "session_agent_revoked",
      });
      return yield* Effect.fail(unauthorized("Invalid agent session"));
    }

    touchAgent(ctx, agent.id);
    touchAgentSession(ctx, sessionRecord.id);
    return toAgentIdentity(agent);
  });

/**
 * Resolve the effective organization ID for a user-authenticated request.
 *
 * Behavior:
 *   - If `X-Abadge-Org-Id` is set: verify the user is a member of that org.
 *   - If absent and the user has 0 memberships: reject with `NO_ORG_MEMBERSHIP`.
 *   - If absent and the user has exactly 1 membership: return it. The query is
 *     ordered by `member.createdAt ASC` so the fallback is deterministic.
 *   - If absent and the user has 2+ memberships: reject with `ORG_HEADER_REQUIRED`
 *     and list available org IDs in `meta` so the caller can retry with a header.
 *
 * Exported for direct unit testing; callers inside this module should prefer
 * `resolveSessionIdentity` / `resolveBearerSessionIdentity`.
 *
 * @internal
 */
export async function resolveUserOrgId(ctx: BaseRequestContext, userId: string): Promise<string> {
  const orgIdHeader = ctx.req.headers.get("X-Abadge-Org-Id");

  if (orgIdHeader) {
    const [membership] = await ctx.db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, orgIdHeader)))
      .limit(1);

    if (!membership) {
      throw new ForbiddenError({
        code: "ORG_MEMBERSHIP_REQUIRED",
        message: "Not a member of the requested organization",
        hint: "Switch to an organization you belong to.",
      });
    }
    return orgIdHeader;
  }

  // Order by createdAt so the single-membership fallback is deterministic. The
  // 2+ memberships case is rejected below, so ordering only affects callers
  // who happen to have exactly one row (and is belt-and-suspenders for races).
  const memberships = await ctx.db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));

  if (memberships.length === 0) {
    throw new UnauthorizedError({
      code: "NO_ORG_MEMBERSHIP",
      message: "User has no organization membership",
      hint: "Complete onboarding to create your first organization.",
    });
  }
  if (memberships.length > 1) {
    throw new BadRequestError({
      code: "ORG_HEADER_REQUIRED",
      message: "X-Abadge-Org-Id header required for multi-org users",
      hint: "Set X-Abadge-Org-Id to the organization context for this request.",
      meta: { availableOrgIds: memberships.map((m) => m.organizationId) },
    });
  }
  // memberships.length === 1 here (0 and >1 branches returned above).
  const [only] = memberships as [(typeof memberships)[number]];
  return only.organizationId;
}

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
      const organizationId = yield* tryAsync(() => resolveUserOrgId(ctx, sessionUserId));
      return {
        kind: "session" as const,
        userId: sessionUserId,
        organizationId,
        authMethod: "browser_session",
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
    )) as AuthSessionResult | null;

    const sessionUserId = sessionLookup?.user?.id ?? sessionLookup?.session?.userId;
    if (sessionUserId) {
      const organizationId = yield* tryAsync(() => resolveUserOrgId(ctx, sessionUserId));
      return {
        kind: "session" as const,
        userId: sessionUserId,
        organizationId,
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

    // Audit the unrecognized-bearer rejection. Covers both abs_-prefixed session
    // tokens that matched no row and legacy-shaped tokens that matched no agent.
    // This satisfies the invariant "every denied attempt is logged" (W2T12-001).
    yield* auditUnrecognizedBearer(ctx, token);
    return yield* Effect.fail(unauthorized("Invalid agent credentials"));
  });
