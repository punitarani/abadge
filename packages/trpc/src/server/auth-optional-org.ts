import { UnauthorizedError } from "@abadge/core";
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

  // Zero → null (fresh signup). One → auto-resolve. Two-or-more + no header →
  // null; bootstrap-safe routes (userProcedure) must handle organizationId=null.
  // Deliberately NOT throwing here — that was the multi-org bootstrap trap (§ORG2).
  if (memberships.length === 1) {
    const [only] = memberships as [(typeof memberships)[number]];
    return only.organizationId;
  }
  return null;
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
