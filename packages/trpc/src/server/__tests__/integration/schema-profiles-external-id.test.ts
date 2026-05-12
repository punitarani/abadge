import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { profiles } from "@abadge/db/schema";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// §RM-PR1 — `profiles.external_id` is the caller-supplied idempotency key for
// API-created profiles. Uniqueness must be enforced per-org BUT only when the
// column is non-NULL, so legacy profiles created before this column existed
// remain valid even though they all collide on NULL.

describe("profiles.externalId schema constraints", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("externalId is unique per org when present", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId, { withDefaultProfile: false });

    await db.insert(profiles).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      name: "first",
      externalId: "cust_1",
      storageMode: "server_managed",
    });

    // The driver surfaces the underlying pg error as the `cause` of the
    // wrapping "Failed query" error, so match by error code instead of the
    // outer message. 23505 = unique_violation.
    let caught: unknown;
    try {
      await db.insert(profiles).values({
        id: crypto.randomUUID(),
        organizationId: org.orgId,
        name: "second",
        externalId: "cust_1",
        storageMode: "server_managed",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe("23505");
  });

  test("same externalId is allowed across different orgs", async () => {
    const owner = await seedUser(auth);
    const orgA = await seedOrg(auth, owner.userId, {
      withDefaultProfile: false,
      slug: `org-a-${crypto.randomUUID()}`,
    });
    const orgB = await seedOrg(auth, owner.userId, {
      withDefaultProfile: false,
      slug: `org-b-${crypto.randomUUID()}`,
    });

    await db.insert(profiles).values({
      id: crypto.randomUUID(),
      organizationId: orgA.orgId,
      name: "in-a",
      externalId: "cust_shared",
      storageMode: "server_managed",
    });

    // No throw — the partial unique index is scoped to (organizationId, externalId)
    await db.insert(profiles).values({
      id: crypto.randomUUID(),
      organizationId: orgB.orgId,
      name: "in-b",
      externalId: "cust_shared",
      storageMode: "server_managed",
    });
  });

  test("multiple NULL externalIds are allowed in the same org", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId, { withDefaultProfile: false });

    // Two profiles, both with NULL externalId, distinct names → must both succeed.
    // This is the whole point of the partial WHERE clause.
    await db.insert(profiles).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      name: "first",
      externalId: null,
      storageMode: "server_managed",
    });

    await db.insert(profiles).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      name: "second",
      externalId: null,
      storageMode: "server_managed",
    });
  });
});
