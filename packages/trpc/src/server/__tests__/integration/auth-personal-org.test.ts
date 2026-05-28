/**
 * Integration coverage for `@abadge/auth`'s `createPersonalOrgForUser`.
 *
 * Lives in the integration directory (real Postgres via Drizzle) rather than
 * `packages/auth/src/`, where it would be picked up by the unit bucket and
 * blow up without a DB. The helper itself is retained for tests + admin
 * seeding only — see AGENTS.md and packages/auth/src/personal-org.ts.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createPersonalOrgForUser } from "@abadge/auth";
import { isPersonalOrg } from "@abadge/core";
import { eq } from "@abadge/db";
import { auditLogs, member, organization, profiles, user as userTable } from "@abadge/db/schema";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("createPersonalOrgForUser", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  async function seedRawUser(email: string, name?: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.insert(userTable).values({
      id,
      email,
      name: name ?? "Test",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  test("happy path — inserts personal org + owner member + default profile + audit row", async () => {
    const userId = await seedRawUser("alice@example.com", "Alice Smith");

    await createPersonalOrgForUser(db, {
      id: userId,
      email: "alice@example.com",
      name: "Alice Smith",
    });

    const orgs = await db.select().from(organization);
    expect(orgs).toHaveLength(1);
    const org = orgs[0];
    if (!org) throw new Error("expected org row");
    expect(org.name).toBe("Alice Smith's workspace");
    expect(org.slug.startsWith("alice-")).toBe(true);
    // The org is flagged personal via metadata (no dedicated column).
    expect(isPersonalOrg(org.metadata)).toBe(true);

    const members = await db.select().from(member).where(eq(member.organizationId, org.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.userId).toBe(userId);
    expect(members[0]?.role).toBe("owner");

    const profileRows = await db.select().from(profiles).where(eq(profiles.organizationId, org.id));
    expect(profileRows).toHaveLength(1);
    // Matches the user-facing flow: name and externalId are both "default".
    expect(profileRows[0]?.name).toBe("default");
    expect(profileRows[0]?.externalId).toBe("default");
    expect(profileRows[0]?.storageMode).toBe("server_managed");

    const audits = await db.select().from(auditLogs).where(eq(auditLogs.organizationId, org.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.eventType).toBe("org.create");
    expect(audits[0]?.surface).toBe("auth");
    expect((audits[0]?.meta as { trigger?: string } | null)?.trigger).toBe(
      "createPersonalOrgForUser",
    );
  });

  test("edge — falls back to default name when user has no name", async () => {
    const userId = await seedRawUser("bob@example.com");

    await createPersonalOrgForUser(db, {
      id: userId,
      email: "bob@example.com",
      name: null,
    });

    const orgs = await db.select().from(organization);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toBe("Personal workspace");
    // Slug derives from the local part of the email + 6-char suffix.
    expect(orgs[0]?.slug.startsWith("bob-")).toBe(true);
  });

  test("edge — falls back to 'user' slug base when email is missing", async () => {
    const userId = await seedRawUser("anon@example.com");

    await createPersonalOrgForUser(db, {
      id: userId,
      email: null,
      name: null,
    });

    const orgs = await db.select().from(organization);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.slug.startsWith("user-")).toBe(true);
  });

  test("adversarial — sanitises non-alphanumeric chars in slug base", async () => {
    const userId = await seedRawUser("Some_User+Tag@example.com");

    await createPersonalOrgForUser(db, {
      id: userId,
      email: "Some_User+Tag@example.com",
      name: null,
    });

    const orgs = await db.select().from(organization);
    const slug = orgs[0]?.slug ?? "";
    expect(slug).toMatch(/^[a-z0-9-]+-[a-f0-9]{6}$/);
  });
});
