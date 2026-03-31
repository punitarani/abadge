import { type Database, eq, and, member } from "@abadge/db";

/** Get all organization IDs a user belongs to */
export async function getUserOrgIds(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));
  return rows.map((r) => r.organizationId);
}

/** Check if a user is an admin or owner of an organization */
export async function isOrgAdmin(
  db: Database,
  userId: string,
  orgId: string,
): Promise<boolean> {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)));
  const role = rows[0]?.role;
  return role === "admin" || role === "owner";
}
