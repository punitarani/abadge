import { BadRequestError, UnauthorizedError } from "@abadge/core";
import { and, asc, eq } from "@abadge/db";
import { member } from "@abadge/db/schema";
import { Effect } from "effect";
import type { AuthSessionResult } from "./auth";
import type { BaseRequestContext, OptionalOrgSessionIdentity } from "./context";
import { tryAsync } from "./effect";

function unauthorized(message: string): UnauthorizedError {
  return new UnauthorizedError({
    code: "UNAUTHORIZED",
    message,
    hint: "Authenticate with a valid session cookie before calling this endpoint.",
  });
}

async function resolveOptionalOrgId(
  ctx: BaseRequestContext,
  userId: string,
): Promise<string | null> {
  const orgIdHeader = ctx.req.headers.get("X-Abadge-Org-Id");
  if (orgIdHeader) {
    const [hit] = await ctx.db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, orgIdHeader)))
      .limit(1);
    if (!hit) {
      throw new UnauthorizedError({
        code: "ORG_MEMBERSHIP_REQUIRED",
        message: "Not a member of the requested organization",
        hint: "Switch to an organization you belong to.",
      });
    }
    return orgIdHeader;
  }

  const memberships = await ctx.db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));

  if (memberships.length === 0) return null;
  if (memberships.length > 1) {
    throw new BadRequestError({
      code: "ORG_HEADER_REQUIRED",
      message: "X-Abadge-Org-Id header required for multi-org users",
      hint: "Set X-Abadge-Org-Id to the organization context for this request.",
      meta: { availableOrgIds: memberships.map((m) => m.organizationId) },
    });
  }
  const [only] = memberships as [(typeof memberships)[number]];
  return only.organizationId;
}

export const resolveSessionIdentityOptionalOrg = (
  ctx: BaseRequestContext,
): Effect.Effect<OptionalOrgSessionIdentity, Error | UnauthorizedError> =>
  Effect.gen(function* () {
    const session = (yield* tryAsync(() =>
      ctx.auth.api.getSession({ headers: ctx.req.headers }),
    )) as AuthSessionResult | null;

    const userId = session?.user?.id ?? session?.session?.userId ?? null;
    if (!userId) return yield* Effect.fail(unauthorized("Unauthorized"));

    const organizationId = yield* tryAsync(() => resolveOptionalOrgId(ctx, userId));
    return {
      kind: "session" as const,
      userId,
      organizationId,
      authMethod: "browser_session",
    };
  });
