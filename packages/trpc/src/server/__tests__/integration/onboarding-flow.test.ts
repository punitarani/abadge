/**
 * Verifies that a newly-registered user with zero org memberships can still
 * reach the three bootstrap endpoints — organizations.list, organizations.checkSlug,
 * and organizations.create — without receiving 401 NO_ORG_MEMBERSHIP.
 *
 * This is review finding P0-1: userProcedure tolerates organizationId: null.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedOrg, seedUser } from "../helpers/seed";
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
  });

  // -------------------------------------------------------------------------
  // 4. X-Abadge-Org-Id header path: bootstrap endpoints work when the caller
  //    passes an explicit org header (user with 1 membership, not zero).
  //    Proves resolveSessionIdentityOptionalOrg handles the header branch
  //    when reached through the full middleware chain.
  // -------------------------------------------------------------------------
  test("organizations.list and checkSlug succeed when X-Abadge-Org-Id header is passed", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "Header Org", slug: "header-org" });

    // Pass the org id via the 4th parameter — createOperatorCaller sets the
    // x-abadge-org-id header internally.
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    const listResult = await caller.organizations.list();
    expect(listResult.organizations).toHaveLength(1);
    expect(listResult.organizations[0].id).toBe(org.orgId);

    const slugResult = await caller.organizations.checkSlug({ slug: "some-other-slug" });
    expect(slugResult.available).toBe(true);
  });
});

/**
 * Regression: a STALE/foreign X-Abadge-Org-Id header (an `activeOrgId` left in
 * the browser from a previous account — it survives sign-out, account deletion,
 * and account switches) must not break the bootstrap surface. It previously
 * threw ORG_MEMBERSHIP_REQUIRED from resolveOptionalOrgId, so organizations.list
 * errored and the dashboard gate showed "We couldn't load your organizations"
 * with no recovery, while create/createPersonal failed too — stranding the user.
 */
describe("onboarding flow: stale/foreign X-Abadge-Org-Id is tolerated", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  // An org id the caller is provably not a member of (e.g. a deleted org still
  // referenced by a persisted activeOrgId).
  const STALE_ORG_ID = "org_stale_not_a_member";

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("zero-org user with a foreign header can still organizations.list (empty, not 403)", async () => {
    const user = await seedUser(auth);
    const caller = createOperatorCaller(db, auth, user.headers, STALE_ORG_ID);

    const result = await caller.organizations.list();
    expect(result.organizations).toEqual([]);
  });

  test("zero-org user with a foreign header can still organizations.create", async () => {
    const user = await seedUser(auth);
    const caller = createOperatorCaller(db, auth, user.headers, STALE_ORG_ID);

    const result = await caller.organizations.create({ name: "Recovered Org", slug: "recovered" });
    expect(result.organization.slug).toBe("recovered");
  });

  test("zero-org user with a foreign header can still organizations.createPersonal", async () => {
    const user = await seedUser(auth);
    const caller = createOperatorCaller(db, auth, user.headers, STALE_ORG_ID);

    const result = await caller.organizations.createPersonal();
    expect(result.organization.id).toBeTruthy();
    expect(result.organization.isPersonal).toBe(true);
  });

  test("a user's real org is still returned when the header points at a stale org (client self-heals)", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "Real Org", slug: "real-org" });

    // The header names a stale org, but the user belongs to `org`. list must
    // return the real membership so the dashboard gate can adopt it.
    const caller = createOperatorCaller(db, auth, user.headers, STALE_ORG_ID);

    const result = await caller.organizations.list();
    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0].id).toBe(org.orgId);
  });
});
