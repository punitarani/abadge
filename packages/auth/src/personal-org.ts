import type { Database } from "@abadge/db";
import { member, organization, profiles } from "@abadge/db/schema";
import { safeAuditInsert } from "./audit-hooks";

/**
 * Creates a personal org + server_managed "internal" profile for a given user.
 *
 * Explicit seeding helper. Signup does NOT auto-invoke this any more — users
 * create or join their first organization through the /onboarding flow
 * (see apps/web/src/app/onboarding/page.tsx). This function is retained for:
 * - tests that need a seeded org without driving the UI
 * - potential admin / migration scripts
 *
 * Design decisions:
 * - Always server_managed: ZK profiles require client-supplied KDF material,
 *   which is not available in a server-only helper.
 * - The caller owns error handling. This function will throw on DB failure.
 */
export async function createPersonalOrgForUser(
  db: Database,
  user: { id: string; email?: string | null; name?: string | null },
): Promise<void> {
  const slugBase = (user.email?.split("@")[0] ?? "user")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  const slug = `${slugBase || "user"}-${crypto.randomUUID().slice(0, 6)}`;
  const orgId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(organization).values({
      id: orgId,
      name: user.name ? `${user.name}'s workspace` : "Personal workspace",
      slug,
      createdAt: now,
    });

    await tx.insert(member).values({
      id: memberId,
      organizationId: orgId,
      userId: user.id,
      role: "owner",
      createdAt: now,
    });

    // server_managed: safe default; no client-side KDF material is available
    // during signup. The user can bootstrap a ZK profile later.
    await tx.insert(profiles).values({
      id: profileId,
      organizationId: orgId,
      name: "internal",
      storageMode: "server_managed",
      createdAt: now,
      updatedAt: now,
    });
  });

  await safeAuditInsert(db, {
    organizationId: orgId,
    userId: user.id,
    eventType: "org.create",
    result: "allowed",
    ipAddress: null,
    surface: "auth",
    meta: { auto: true, trigger: "createPersonalOrgForUser", slug },
  });
}
