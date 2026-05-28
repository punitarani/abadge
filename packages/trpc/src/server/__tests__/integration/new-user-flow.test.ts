/**
 * Integration tests for `createPersonalOrgForUser` — the explicit seeding
 * helper retained for tests and admin/migration scripts after the
 * Better Auth signup hook was removed (onboarding is user-driven via
 * `/onboarding` and `/join`).
 *
 * Historical context: §ON5 / §ON5b previously asserted that
 * `organizations.create` seeded a default profile from caller-supplied
 * storageMode + ZK fields. That behavior was removed when the bug it
 * caused — onboarding step 2 always conflicting with the auto-seeded
 * "internal" profile — was fixed; profiles are now created explicitly
 * via `profiles.create`. Those tests are gone with the behavior they
 * pinned. The §ON6 invariant for the standalone seeding helper remains.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createPersonalOrgForUser } from "@abadge/auth";
import { eq } from "@abadge/db";
import { member, organization, profiles } from "@abadge/db/schema";
import { seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("new-user flow (§ON6 createPersonalOrgForUser)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("§ON6 — createPersonalOrgForUser seeds 1 org + server_managed profile for a fresh user", async () => {
    // seedUser inserts the user row via testUtils (raw adapter insert). The
    // function is no longer wired to any Better Auth hook; it is exercised
    // here to pin the seeding contract for tests and admin scripts that
    // still depend on it.
    const seedResult = await seedUser(auth);

    await createPersonalOrgForUser(db, {
      id: seedResult.userId,
      email: seedResult.email,
      name: seedResult.name,
    });

    const memberships = await db.select().from(member).where(eq(member.userId, seedResult.userId));
    expect(memberships).toHaveLength(1);

    const firstMembership = memberships[0];
    expect(firstMembership).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    const orgId = firstMembership!.organizationId;

    const orgs = await db.select().from(organization).where(eq(organization.id, orgId));
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toContain("workspace");

    const profileRows = await db.select().from(profiles).where(eq(profiles.organizationId, orgId));
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0]?.name).toBe("default");
    expect(profileRows[0]?.storageMode).toBe("server_managed");
    // server_managed profiles must not have ZK key material.
    expect(profileRows[0]?.wrappedRootKey).toBeFalsy();
  });
});
