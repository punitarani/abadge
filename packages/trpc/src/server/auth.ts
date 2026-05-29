import {
  AGENT_SESSION_PREFIX,
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
  USER_API_KEY_PREFIX,
} from "@abadge/core";
import { hashApiKey, verifyApiKey } from "@abadge/crypto/shared";
import { and, asc, eq, isNull, lt, or } from "@abadge/db";
import {
  agents as agentRecords,
  agentSessions,
  auditLogs,
  member,
  userApiKeys,
} from "@abadge/db/schema";
import { Effect } from "effect";
import type { AgentIdentity, BaseRequestContext, SessionIdentity } from "./context";
import { tryAsync } from "./effect";

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
    hint: "Authenticate with a Better Auth session, a personal API key (abu_), or an agent session token (abs_).",
  });
}

function getBearerToken(ctx: BaseRequestContext): Effect.Effect<string, UnauthorizedError> {
  const authHeader = ctx.req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return Effect.succeed(authHeader.slice(7));
  }

  return Effect.fail(unauthorized("Missing Bearer token"));
}

// Refresh last_used_at only when it is older than this. Turns a write on EVERY
// authenticated request into an occasional one — removing the per-request
// row-lock / WAL / single-row contention on the hot auth tables (user_api_keys,
// agents, agent_sessions). The touch stays fire-and-forget; the staleness check
// lives in the UPDATE's WHERE, so a recently-touched row matches 0 rows and the
// statement writes nothing.
const LAST_USED_THROTTLE_MS = 15 * 60 * 1000;

function touchAgent(ctx: BaseRequestContext, agentId: string): void {
  const staleBefore = new Date(Date.now() - LAST_USED_THROTTLE_MS);
  void ctx.db
    .update(agentRecords)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(agentRecords.id, agentId),
        or(isNull(agentRecords.lastUsedAt), lt(agentRecords.lastUsedAt, staleBefore)),
      ),
    )
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
  const staleBefore = new Date(Date.now() - LAST_USED_THROTTLE_MS);
  void ctx.db
    .update(agentSessions)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(agentSessions.id, sessionId),
        or(isNull(agentSessions.lastUsedAt), lt(agentSessions.lastUsedAt, staleBefore)),
      ),
    )
    .execute()
    .catch(() => {});
}

function auditAgentSessionReject(
  ctx: BaseRequestContext,
  input: {
    // §AB-0043 — null when the rejected agent is orphaned (no owning user).
    userId: string | null;
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

// Best-effort dampening of audit writes for unrecognized bearers, to reduce
// attacker-driven audit-log amplification: ~1 write per IP per 10s window.
// This counter is a module-level in-memory Map, so on Cloudflare Workers the
// bound is per-isolate, not global: each isolate keeps its own counters and
// isolates are ephemeral. A probe scattered across many isolates can therefore
// exceed the nominal per-IP cap. The hard global bound on unauth probe volume
// is the request-level rate-limit middleware (apps/api); this map only trims
// redundant audit rows within a single isolate's lifetime.
const UNAUTH_AUDIT_WINDOW_MS = 10_000;
// Hard cap on map entries. Under a scattered-source attack the map would grow
// unbounded (one entry per unique probe IP) — the cap bounds memory to
// ~2.4MB (10k entries × ~240 bytes/entry). When the cap is hit the map is
// cleared wholesale; attacker can't amplify audit writes because they're
// still gated per-IP per-window, and legitimate IPs re-populate naturally.
const UNAUTH_AUDIT_MAX_ENTRIES = 10_000;
const unauthBearerAuditCounters = new Map<string, { resetAt: number }>();

export function shouldWriteUnauthBearerAudit(ipAddress: string | undefined): boolean {
  const key = ipAddress ?? "__unknown_ip__";
  const now = Date.now();
  const entry = unauthBearerAuditCounters.get(key);
  if (!entry || entry.resetAt < now) {
    if (unauthBearerAuditCounters.size >= UNAUTH_AUDIT_MAX_ENTRIES) {
      unauthBearerAuditCounters.clear();
    }
    unauthBearerAuditCounters.set(key, { resetAt: now + UNAUTH_AUDIT_WINDOW_MS });
    return true;
  }
  return false;
}

/** Exported for tests only. */
export function _resetUnauthBearerAuditCounters(): void {
  unauthBearerAuditCounters.clear();
}

/** Exported for tests only. */
export function _unauthBearerAuditMapSize(): number {
  return unauthBearerAuditCounters.size;
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
            // §AB-0043 — an orphaned agent (createdBy IS NULL) still validates its session;
            // an owned agent's creator must still match the session's recorded user. The two
            // null states move together — the user-delete FK SET-NULLs createdBy and the
            // session's userId atomically — so a null session user pairs with a null createdBy.
            sessionRecord.userId === null
              ? isNull(agentRecords.createdBy)
              : eq(agentRecords.createdBy, sessionRecord.userId),
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

function touchUserApiKey(ctx: BaseRequestContext, keyId: string): void {
  const staleBefore = new Date(Date.now() - LAST_USED_THROTTLE_MS);
  void ctx.db
    .update(userApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(userApiKeys.id, keyId),
        or(isNull(userApiKeys.lastUsedAt), lt(userApiKeys.lastUsedAt, staleBefore)),
      ),
    )
    .execute()
    .catch(() => {});
}

/**
 * Audit a rejected-but-recognized personal API key (the hash matched a stored
 * key, but it was expired). A wrong-secret miss returns null and falls through
 * like any unrecognized bearer; only a real-key rejection writes a row here, to
 * mirror `auditAgentSessionReject`'s "expired" handling.
 *
 * Uses event type `user_api_key.expire` — distinct from `user_api_key.revoke`
 * (admin-initiated) so audit queries can distinguish passive expiry.
 */
function auditUserApiKeyReject(
  ctx: BaseRequestContext,
  input: { userId: string; organizationId: string; result: "expired"; reason: string },
): Effect.Effect<void, never> {
  return tryAsync(() =>
    ctx.db
      .insert(auditLogs)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        agentId: null,
        eventType: "user_api_key.expire",
        result: input.result,
        meta: { reason: input.reason },
        ipAddress: ctx.ipAddress ?? null,
      })
      .then(() => undefined),
  ).pipe(
    Effect.catchAll((err) => {
      console.warn(
        `audit_write_failed (user_api_key_reject) err=${err instanceof Error ? err.message : String(err)}`,
      );
      return Effect.void;
    }),
  );
}

/**
 * Resolve a personal user API key (`abu_`) to a SESSION identity. The key is
 * bound to one (user, org); that org is authoritative (we do NOT consult
 * `X-Abadge-Org-Id` or `resolveUserOrgId`). Returns null on no match so the
 * caller can fall through to the Better Auth bearer-session lookup.
 *
 * Because this resolves to `kind:"session"`, an `abu_` key can never enter the
 * agent-only `access.*` surface (that requires `resolveAgentIdentity`).
 */
const resolveUserApiKeyIdentity = (
  ctx: BaseRequestContext,
  token: string,
): Effect.Effect<SessionIdentity | null, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    // `generateApiKey` always stores an 8-character prefix; a direct equality
    // lookup hits the btree index with no dead OR-clauses.
    const candidates = yield* tryAsync(() =>
      ctx.db
        .select({
          id: userApiKeys.id,
          userId: userApiKeys.userId,
          organizationId: userApiKeys.organizationId,
          secretHash: userApiKeys.secretHash,
          expiresAt: userApiKeys.expiresAt,
        })
        .from(userApiKeys)
        .where(
          and(
            eq(userApiKeys.secretPrefix, token.slice(0, 8)),
            eq(userApiKeys.enabled, true),
            isNull(userApiKeys.revokedAt),
          ),
        )
        .limit(10),
    );

    for (const key of candidates) {
      const valid = yield* tryAsync(() => verifyApiKey(token, key.secretHash));
      if (!valid) {
        continue;
      }

      if (key.expiresAt && key.expiresAt <= new Date()) {
        yield* auditUserApiKeyReject(ctx, {
          userId: key.userId,
          organizationId: key.organizationId,
          result: "expired",
          reason: "user_api_key_expired",
        });
        return yield* Effect.fail(unauthorized("Expired user API key"));
      }

      touchUserApiKey(ctx, key.id);
      return {
        kind: "session" as const,
        userId: key.userId,
        organizationId: key.organizationId,
        authMethod: "user_api_key",
      };
    }

    // No stored key matched this abu_ token (wrong secret or guessed prefix).
    // Audit the unrecognized-bearer probe — same signal and rate-limiting as the
    // agent path — then fall through to the generic unauthorized rejection.
    yield* auditUnrecognizedBearer(ctx, token);
    return null;
  });

const resolveBearerSessionIdentity = (
  ctx: BaseRequestContext,
): Effect.Effect<SessionIdentity | null, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const authHeader = ctx.req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }

    const token = authHeader.slice(7);

    // Personal user API key (`abu_`) — resolves to a session identity bound to
    // the key's own org. Checked before the Better Auth session lookup.
    if (token.startsWith(USER_API_KEY_PREFIX)) {
      return yield* resolveUserApiKeyIdentity(ctx, token);
    }

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

    // Keypair-backed `abs_` agent sessions are the only agent credential. Anything
    // else (a personal `abu_` key, a browser session token, garbage) is not an
    // agent and must not reach the agent surface. Audit the unrecognized-bearer
    // rejection — "every denied attempt is logged" (W2T12-001).
    yield* auditUnrecognizedBearer(ctx, token);
    return yield* Effect.fail(unauthorized("Invalid agent credentials"));
  });
