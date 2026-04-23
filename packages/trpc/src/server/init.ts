import { ForbiddenError, NotFoundError } from "@abadge/core";
import type { Database } from "@abadge/db";
import { and, eq } from "@abadge/db";
import { agents, member } from "@abadge/db/schema";
import { TRPCError, initTRPC } from "@trpc/server";
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
  db: Database,
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

const t = initTRPC.context<BaseRequestContext>().create({
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

export const scopedSessionProcedure = (_scope: string) =>
  sessionProcedure.use(async ({ ctx, next }) => {
    if (!ctx.identity.organizationId) {
      throw new ForbiddenError({
        code: "FORBIDDEN",
        message: "Organization context required",
        hint: "Complete onboarding to create or join an organization.",
      });
    }
    await requireOrgRole(ctx.db, ctx.identity.organizationId, ctx.identity.userId, "member");
    return next({ ctx });
  });

export const agentProcedure = publicProcedure.use(async ({ ctx, next }) => {
  try {
    const identity = await Effect.runPromise(resolveAgentIdentity(ctx));
    return next({
      ctx: {
        ...ctx,
        identity,
      } satisfies AgentRequestContext,
    });
  } catch (error) {
    throw toTrpcError(error);
  }
});

export async function requireAgentOwnership(
  db: Database,
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
