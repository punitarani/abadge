import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { auditLogs, items, organization, profiles } from "@abadge/db/schema";
import { seedMember, seedOrg, seedServerItem, seedUser, setUserPassword } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

const PASSWORD = "correct-horse-battery-staple";

/**
 * `organizations.delete` now permits deletion even when items exist, gated by
 *   - a typed-name confirmation (`confirmName` must equal the org name), and
 *   - re-authentication (`password` re-verified against the credential account).
 * Deleting the org cascades items/profiles/agents/permissions; audit logs are
 * preserved (no FK). Every denied attempt is logged.
 */
describe("organizations.delete (confirm + reauth)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  async function seedOwnerWithOrg(orgName = "Acme Inc") {
    const owner = await seedUser(auth);
    await setUserPassword(auth, owner.userId, PASSWORD);
    const org = await seedOrg(auth, owner.userId, { name: orgName });
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    return { owner, org, caller };
  }

  test("deletes an org that still has items, cascading the items away", async () => {
    const { owner, org, caller } = await seedOwnerWithOrg();
    await seedServerItem(db, { userId: owner.userId, orgId: org.orgId, label: "db-creds" });
    await seedServerItem(db, { userId: owner.userId, orgId: org.orgId, label: "api-key" });

    const result = await caller.organizations.delete({
      orgId: org.orgId,
      confirmName: "Acme Inc",
      password: PASSWORD,
    });
    expect(result.ok).toBe(true);

    // Org row gone; items + profiles cascaded.
    const orgRows = await db.select().from(organization).where(eq(organization.id, org.orgId));
    expect(orgRows).toHaveLength(0);
    const itemRows = await db.select().from(items).where(eq(items.organizationId, org.orgId));
    expect(itemRows).toHaveLength(0);
    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, org.orgId));
    expect(profileRows).toHaveLength(0);

    // Audit log preserved (no FK) with an allowed org.delete.
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org.orgId), eq(auditLogs.eventType, "org.delete")));
    expect(audit.some((a) => a.result === "allowed")).toBe(true);
  });

  test("rejects when the typed name does not match, and logs a denied attempt", async () => {
    const { org, caller } = await seedOwnerWithOrg();

    await expect(
      caller.organizations.delete({
        orgId: org.orgId,
        confirmName: "Wrong Name",
        password: PASSWORD,
      }),
    ).rejects.toThrow();

    // Org still present.
    const orgRows = await db.select().from(organization).where(eq(organization.id, org.orgId));
    expect(orgRows).toHaveLength(1);

    const denied = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org.orgId), eq(auditLogs.eventType, "org.delete")));
    expect(denied.some((a) => a.result === "denied")).toBe(true);
  });

  test("rejects when the password is wrong, and logs a denied attempt", async () => {
    const { org, caller } = await seedOwnerWithOrg();

    await expect(
      caller.organizations.delete({
        orgId: org.orgId,
        confirmName: "Acme Inc",
        password: "not-my-password",
      }),
    ).rejects.toThrow();

    const orgRows = await db.select().from(organization).where(eq(organization.id, org.orgId));
    expect(orgRows).toHaveLength(1);

    const denied = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org.orgId), eq(auditLogs.eventType, "org.delete")));
    expect(denied.some((a) => a.result === "denied")).toBe(true);
  });

  test("rejects when the caller's account has no password (social-only)", async () => {
    const owner = await seedUser(auth); // no setUserPassword
    const org = await seedOrg(auth, owner.userId, { name: "No Password Org" });
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    await expect(
      caller.organizations.delete({
        orgId: org.orgId,
        confirmName: "No Password Org",
        password: "anything",
      }),
    ).rejects.toThrow();

    const orgRows = await db.select().from(organization).where(eq(organization.id, org.orgId));
    expect(orgRows).toHaveLength(1);
  });

  test("rejects a non-owner member even with the right name + password", async () => {
    const { org } = await seedOwnerWithOrg();
    const member = await seedUser(auth);
    await setUserPassword(auth, member.userId, PASSWORD);
    await seedMember(auth, org.orgId, member.userId, "member");
    const memberCaller = createOperatorCaller(db, auth, member.headers, org.orgId);

    await expect(
      memberCaller.organizations.delete({
        orgId: org.orgId,
        confirmName: "Acme Inc",
        password: PASSWORD,
      }),
    ).rejects.toThrow();

    const orgRows = await db.select().from(organization).where(eq(organization.id, org.orgId));
    expect(orgRows).toHaveLength(1);
  });
});
