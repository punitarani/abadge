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
    // Honor the header only when the caller actually belongs to that org.
    if (hit) return orgIdHeader;
    // A header pointing at an org the caller is NOT a member of is almost always
    // a STALE `activeOrgId` persisted in the browser from a previous account
    // (the `abadge-org` store survives sign-out, account deletion, and account
    // switches). For bootstrap-safe routes this must NOT be fatal: throwing
    // ORG_MEMBERSHIP_REQUIRED here makes organizations.list/create/createPersonal
    // fail, which strands a freshly-signed-up user on the dashboard error card
    // with no recovery — those are the very calls the client uses to discover
    // and repair its org context. Treat a foreign header as "no org context"
    // and fall through to membership resolution, exactly as if no header were
    // sent. Org-SCOPED routes still reject a foreign header strictly via
    // resolveUserOrgId in auth.ts.
  }

  const memberships = await ctx.db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));

  // Zero → null (fresh signup). One → auto-resolve. Two-or-more, or a foreign
  // header that fell through above → null; bootstrap-safe routes (userProcedure)
  // must handle organizationId=null. Deliberately NOT throwing here — a multi-org
  // user with no header is a valid bootstrap state, not an error.
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
