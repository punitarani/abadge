import type { Database } from "@abadge/db";
import { member, organization, profiles } from "@abadge/db/schema";
import { safeAuditInsert } from "./audit-hooks";

/**
 * Creates a personal org + server_managed "internal" profile for a new user.
 *
 * §ON6 — AGENTS.md invariant: "Every user gets a personal org on first login."
 * Called from the Better Auth databaseHooks.user.create.after hook in server.ts.
 * Also exported for direct unit testing.
 *
 * Design decisions:
 * - Always server_managed: the user can create a ZK profile later via the
 *   normal profiles.create flow. Creating a ZK profile here would require
 *   client-supplied KDF material which is not available in a server-side hook.
 * - Never throws: callers swallow errors so that signup is never rejected
 *   because the auto-org creation failed.
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
    meta: { auto: true, trigger: "user.create.after", slug },
  });
}
