import { ForbiddenError, NotFoundError } from "@abadge/core";
import type { Database, Transaction } from "@abadge/db";
import { and, eq, sql } from "@abadge/db";
import { agents, member } from "@abadge/db/schema";
import { initTRPC, type TRPCError } from "@trpc/server";
import { Effect } from "effect";
import { resolveAgentIdentity, resolveSessionIdentity } from "./auth";
import { resolveSessionIdentityOptionalOrg } from "./auth-optional-org";
import type {
  AgentRequestContext,
  BaseRequestContext,
  OptionalOrgSessionRequestContext,
  SessionRequestContext,
} from "./context";
import { getTrpcErrorData, toTrpcError } from "./errors";

const ROLE_RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };

export function roleRank(role: string): number {
  return ROLE_RANK[role] ?? 0;
}

/** Returns the caller's role if they are a member of the org with at least minRole; throws ForbiddenError otherwise. */
export async function requireOrgRole(
  db: Database | Transaction,
  orgId: string,
  userId: string,
  minRole: "owner" | "admin" | "member",
): Promise<string> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);

  if (!row) {
    throw new ForbiddenError({
      code: "MEMBER_INSUFFICIENT_ROLE",
      message: "You are not a member of this organization",
      hint: "Join the organization before performing this action.",
    });
  }

  if (roleRank(row.role) < roleRank(minRole)) {
    throw new ForbiddenError({
      code: "MEMBER_INSUFFICIENT_ROLE",
      message: "Insufficient role",
      hint: `This action requires the '${minRole}' role or higher.`,
    });
  }

  return row.role;
}

// Exported for unit testing. Production use is only via the initTRPC config below.
export function trpcErrorFormatter({
  shape,
  error,
}: {
  shape: { message: string; code: number; data?: Record<string, unknown> };
  error: TRPCError;
}) {
  // Whitelist only the fields that belong on the wire. tRPC's default isDev
  // is derived from NODE_ENV, which is unset on Cloudflare Workers → defaults
  // to true, meaning shape.data.stack, shape.data.path, and shape.data.zodError
  // would be serialised in production. We unconditionally omit them here.
  // Developers read stack traces from logs; operators read them from Workers
  // observability. Neither audience needs them in the response body.
  return {
    ...shape,
    data: {
      code: shape.data?.code,
      httpStatus: shape.data?.httpStatus,
      ...getTrpcErrorData(error),
    },
  };
}

/**
 * Procedure metadata describing the canonical REST surface that exposes the
 * procedure. Consumed by the hand-written `/v1` adapter in `apps/api/src/rest`
 * to generate both the request router and the OpenAPI 3.1 document.
 *
 * We picked a hand-written adapter over `trpc-to-openapi` because that
 * package requires `zod ^4` as a peer dep; this codebase uses Effect Schema
 * exclusively (see `@abadge/core`). Adding a parallel zod schema layer would
 * duplicate validation. Keeping the table in code is also a single source of
 * truth for both the router and the spec.
 *
 * `path` placeholders use `{paramName}` form and must appear in the procedure
 * input shape so the REST adapter can splice them in.
 */
export interface RestMeta {
  openapi: {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    path: string;
    tags: string[];
    /** True when the procedure requires authentication. */
    protect: boolean;
    summary?: string;
  };
}

const t = initTRPC.context<BaseRequestContext>().meta<RestMeta>().create({
  errorFormatter: trpcErrorFormatter,
});

export const createTrpcRouter = t.router;
export const createTrpcCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

export const sessionProcedure = publicProcedure.use(async ({ ctx, next }) => {
  try {
    const identity = await Effect.runPromise(resolveSessionIdentity(ctx));
    return next({
      ctx: {
        ...ctx,
        identity,
      } satisfies SessionRequestContext,
    });
  } catch (error) {
    throw toTrpcError(error);
  }
});

/**
 * Authenticated procedure that does NOT require org membership. Use this for
 * bootstrap endpoints a user hits before they have an org (organizations.create,
 * organizations.list, organizations.checkSlug, organizations.members.getInviteInfo,
 * organizations.members.acceptInvite). Everywhere else, use sessionProcedure.
 *
 * Org resolution is convenience-best-effort: if the user has exactly one
 * membership, organizationId is auto-populated. If they have zero memberships
 * or multiple memberships (without an explicit X-Abadge-Org-Id header),
 * organizationId is null. Callers that need a specific org should either
 * use sessionProcedure (requires explicit context) or handle organizationId
 * being null. This null-return for multi-org + no-header is intentional (§ORG2);
 * do not re-introduce the ORG_HEADER_REQUIRED throw here.
 */
export const userProcedure = publicProcedure.use(async ({ ctx, next }) => {
  try {
    const identity = await Effect.runPromise(resolveSessionIdentityOptionalOrg(ctx));
    return next({
      ctx: {
        ...ctx,
        identity,
      } satisfies OptionalOrgSessionRequestContext,
    });
  } catch (error) {
    throw toTrpcError(error);
  }
});

/**
 * §AB-0011 — run `fn` inside a transaction whose first statement sets the
 * `app.current_org` GUC that the FORCE-RLS policies read. `set_config(_,_,true)`
 * is transaction-local — the only form that survives Hyperdrive connection
 * pooling. A router that later opens `ctx.db.transaction(...)` nests as a
 * SAVEPOINT and inherits this GUC, so cascade deletes on `permissions` etc. run
 * under the right org context without touching cascade code. The `as Database`
 * cast is safe: both `Database` and `Transaction` expose `.transaction()` (the
 * latter as a savepoint); the cast only sidesteps the union-method signature.
 */
function withOrgContext<T extends { ok: boolean }>(
  db: Database | Transaction,
  orgId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return (db as Database).transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
    const result = await fn(tx);
    if (result.ok) return result;
    // tRPC's `next()` RESOLVES with `{ ok: false, error }` on a procedure error
    // rather than throwing, so we must decide commit-vs-rollback ourselves:
    //  - a DOMAIN error (e.g. a denied/expired access) leaves the pg transaction
    //    HEALTHY, and the access pipeline has already written an audit row that
    //    MUST persist ("every denied attempt is logged") — so commit by returning.
    //  - a failed SQL statement (e.g. a unique violation) has ABORTED the pg
    //    transaction; returning would let drizzle COMMIT and surface a raw DB
    //    error that masks the mapped domain error — so roll back and surface
    //    result.error instead.
    // A no-op probe distinguishes the two: it throws 25P02 only on an aborted tx.
    try {
      await tx.execute(sql`select 1`);
      return result;
    } catch {
      throw (result as { error?: unknown }).error;
    }
  });
}

export const scopedSessionProcedure = (_scope: string) =>
  sessionProcedure.use(async ({ ctx, next }) => {
    try {
      if (!ctx.identity.organizationId) {
        throw new ForbiddenError({
          code: "FORBIDDEN",
          message: "Organization context required",
          hint: "Create or join an organization first.",
        });
      }
      // requireOrgRole reads `member` (not an RLS table) on the pooled connection
      // before the org transaction opens — fine, and it must run before we commit
      // to an org context.
      const orgId = ctx.identity.organizationId;
      await requireOrgRole(ctx.db, orgId, ctx.identity.userId, "member");
      // §REVAMP-PR3 Task 5.2 — the at-use onboarding-completeness gate was
      // dropped here. `organizations.create` now auto-seeds a default
      // server_managed profile in the same transaction (Task 5.1), so an org
      // is unbootstrapped only if a user explicitly deletes every profile —
      // an action that already requires admin role and is itself audit-logged.
      //
      // §AB-0011 — run the rest of the request under the org GUC so every
      // tenant-table query is RLS-scoped to this org.
      return await withOrgContext(ctx.db, orgId, (tx) => next({ ctx: { ...ctx, db: tx } }));
    } catch (error) {
      // Convert domain errors (ForbiddenError, etc.) into TRPCError with the
      // proper status and domain code preserved in `data`. Without this, any
      // ForbiddenError thrown above would surface as INTERNAL_SERVER_ERROR
      // (pre-existing bug for the "not a member" path as well).
      throw toTrpcError(error);
    }
  });

export const agentProcedure = publicProcedure.use(async ({ ctx, next }) => {
  try {
    // Identity resolution reads the `agents` table BEFORE the org is known (the
    // org is derived from the agent row). It runs on the pooled connection,
    // pre-transaction; `agents` is RLS-exempt (migration 0025_agents_rls_exemption)
    // precisely so this pre-org read is not fail-closed under the runtime role.
    const identity = await Effect.runPromise(resolveAgentIdentity(ctx));
    // §REVAMP-PR3 Task 5.2 — the agent-side onboarding gate was dropped here.
    // Auto-seeded default profiles (Task 5.1) make the gate redundant on the
    // happy path; the rare "all profiles deleted" case surfaces as a domain
    // error from individual access procedures, not a blanket middleware
    // reject. Per-procedure audit rows for denied access remain unchanged.
    //
    // §AB-0011 — open the org GUC transaction only after identity resolution, so
    // every tenant-table query in the access pipeline is RLS-scoped to the
    // agent's org.
    return await withOrgContext(ctx.db, identity.agentOrganizationId, (tx) =>
      next({ ctx: { ...ctx, identity, db: tx } satisfies AgentRequestContext }),
    );
  } catch (error) {
    throw toTrpcError(error);
  }
});

export async function requireAgentOwnership(
  db: Database | Transaction,
  agentId: string,
  userId: string,
  orgId: string,
  userRole: string,
): Promise<void> {
  if (roleRank(userRole) >= roleRank("admin")) return;

  const [agent] = await db
    .select({ createdBy: agents.createdBy })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.organizationId, orgId)))
    .limit(1);

  if (!agent) {
    throw new NotFoundError({
      code: "AGENT_NOT_FOUND",
      message: "Agent not found",
      hint: "Check the agent ID and make sure it belongs to this organization.",
    });
  }

  if (agent.createdBy !== userId) {
    throw new ForbiddenError({
      code: "MEMBER_AGENT_OWNERSHIP",
      message: "Cannot manage permissions on an agent you did not create",
      hint: "Members can only manage permissions on agents they created. Ask an admin.",
    });
  }
}
