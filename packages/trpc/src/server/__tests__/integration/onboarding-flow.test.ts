/**
 * Verifies that a newly-registered user with zero org memberships can still
 * reach the three bootstrap endpoints — organizations.list, organizations.checkSlug,
 * and organizations.create — without receiving 401 NO_ORG_MEMBERSHIP.
 *
 * This is review finding P0-1: userProcedure tolerates organizationId: null.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("onboarding flow: zero-org user can reach bootstrap endpoints", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // 1. organizations.list returns empty array (not 401) for a fresh user
  // -------------------------------------------------------------------------
  test("organizations.list returns empty array for user with no org memberships", async () => {
    const user = await seedUser(auth);
    // No seedOrg call — this user has zero memberships
    const caller = createOperatorCaller(db, auth, user.headers);

    const result = await caller.organizations.list();
    expect(result.organizations).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. organizations.checkSlug returns available: true (not 401)
  // -------------------------------------------------------------------------
  test("organizations.checkSlug returns available: true for user with no org memberships", async () => {
    const user = await seedUser(auth);
    const caller = createOperatorCaller(db, auth, user.headers);

    const result = await caller.organizations.checkSlug({ slug: "new-slug" });
    expect(result.available).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. organizations.create succeeds and returns the new org (not 401)
  // -------------------------------------------------------------------------
  test("organizations.create succeeds for user with no org memberships", async () => {
    const user = await seedUser(auth);
    const caller = createOperatorCaller(db, auth, user.headers);

    const result = await caller.organizations.create({
      name: "Bootstrap Org",
      slug: "bootstrap-org",
    });

    expect(result.organization.slug).toBe("bootstrap-org");
    expect(result.organization.name).toBe("Bootstrap Org");
    expect(result.profileId).toBeTruthy();
  });
});
