import { ConflictError, ForbiddenError } from "@abadge/core";
import type { Database } from "@abadge/db";
import { and, count, eq, ne } from "@abadge/db";
import { member } from "@abadge/db/schema";
import { roleRank } from "../init";

/**
 * Count owners in an org, optionally excluding a member row (e.g. when
 * about to remove or demote a specific member, count the REMAINING owners).
 */
export async function countOwners(
  db: Database,
  orgId: string,
  excludeMemberId?: string,
): Promise<number> {
  const conditions = excludeMemberId
    ? and(
        eq(member.organizationId, orgId),
        eq(member.role, "owner"),
        ne(member.id, excludeMemberId),
      )
    : and(eq(member.organizationId, orgId), eq(member.role, "owner"));

  const [result] = await db.select({ count: count() }).from(member).where(conditions);
  return result?.count ?? 0;
}

/**
 * Enforce the caller-role cap: the actor cannot invite/assign a role higher
 * than their own. Throws ForbiddenError (MEMBER_INSUFFICIENT_ROLE) if the
 * target role exceeds the actor role.
 *
 * Must be wrapped in tryAsync inside Effect.gen because sync throws become
 * defects otherwise.
 */
export function assertCanAssignRole(actorRole: string, targetRole: string): void {
  if (roleRank(targetRole) > roleRank(actorRole)) {
    throw new ForbiddenError({
      code: "MEMBER_INSUFFICIENT_ROLE",
      message: `Cannot assign role '${targetRole}' — you have role '${actorRole}'`,
      hint: "Ask an owner to perform this action.",
    });
  }
}

/**
 * Enforce the last-owner invariant: the org must not be left with zero owners
 * after a remove or demote operation. Throws ConflictError (CONFLICT) if the
 * change would strand the org.
 *
 * @param memberIdBeingChanged - the member row id being removed or demoted
 * @param targetCurrentRole - the current role of that member
 * @param newRoleOrRemoval - "removed" if the member is being deleted, else
 *   the new role string (e.g. "admin", "member")
 *
 * Must be wrapped in tryAsync inside Effect.gen because sync throws become
 * defects otherwise.
 */
export async function assertOwnersRemainAfterChange(
  db: Database,
  orgId: string,
  memberIdBeingChanged: string,
  targetCurrentRole: string,
  newRoleOrRemoval: "removed" | string,
): Promise<void> {
  // Only relevant if we're removing/demoting an owner.
  if (targetCurrentRole !== "owner") return;
  const willStillBeOwner = newRoleOrRemoval === "owner";
  if (willStillBeOwner) return;
  const remaining = await countOwners(db, orgId, memberIdBeingChanged);
  if (remaining < 1) {
    throw new ConflictError({
      code: "CONFLICT",
      message: "Cannot leave organization without an owner",
      hint: "Promote another member to owner before removing or demoting the sole owner.",
    });
  }
}
