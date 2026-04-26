/**
 * Verifies that a newly-registered user with zero org memberships can still
 * reach the three bootstrap endpoints — organizations.list, organizations.checkSlug,
 * and organizations.create — without receiving 401 NO_ORG_MEMBERSHIP.
 *
 * This is review finding P0-1: userProcedure tolerates organizationId: null.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { auditLogs } from "@abadge/db/schema";

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

  // -------------------------------------------------------------------------
  // 5. auth.recordLogin succeeds for a zero-org user (no audit row written).
  //    Before this fix, recordLogin used sessionProcedure and 401'd the CLI
  //    immediately after GitHub OAuth redirected back, before onboarding.
  // -------------------------------------------------------------------------
  test("auth.recordLogin succeeds for user with no org memberships", async () => {
    const user = await seedUser(auth);
    const caller = createOperatorCaller(db, auth, user.headers);

    const result = await caller.auth.recordLogin();
    expect(result.ok).toBe(true);

    // No org context => no audit row. We skip the insert rather than write a
    // row with null organizationId to keep the audit schema org-consistent.
    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.userId, user.userId), eq(auditLogs.eventType, "auth.login")));
    expect(rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 6. auth.recordLogin writes an audit row once the user has an org context.
  // -------------------------------------------------------------------------
  test("auth.recordLogin writes audit row when org context is present", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    const result = await caller.auth.recordLogin();
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.userId, user.userId),
          eq(auditLogs.organizationId, org.orgId),
          eq(auditLogs.eventType, "auth.login"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toBe("allowed");
  });
});
