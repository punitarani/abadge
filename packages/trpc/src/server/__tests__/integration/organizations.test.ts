import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { member, organization, profiles } from "@abadge/db/schema";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * `organizations.create` tests cover:
 *   - atomicity: org + member + default profile all or nothing
 *   - slug-race translation: the insert-time unique violation surfaces as
 *     SLUG_TAKEN, not a raw INTERNAL_SERVER_ERROR
 *
 * Every test user must already have an org membership to pass
 * `resolveSessionIdentity` — we seed a throwaway "bootstrap" org and then call
 * `organizations.create` (with the header pinned to the bootstrap org) to
 * create a second org under test.
 */
describe("organizations.create atomicity + slug translation", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("always creates a default profile on success", async () => {
    const owner = await seedUser(auth);
    const bootstrap = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, bootstrap.orgId);

    const result = await caller.organizations.create({
      name: "Acme Inc",
      slug: "acme-ok",
    });

    expect(result.organization.slug).toBe("acme-ok");
    expect(result.profileId).toBeTruthy();

    // Default profile must exist — the dashboard assumes this invariant.
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, result.profileId))
      .limit(1);
    expect(profile).toBeDefined();
    expect(profile?.organizationId).toBe(result.organization.id);
    expect(profile?.name).toBe("default");

    // Caller is registered as owner of the new org.
    const [ownerMember] = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, result.organization.id))
      .limit(1);
    expect(ownerMember?.userId).toBe(owner.userId);
    expect(ownerMember?.role).toBe("owner");
  });

  test("returns SLUG_TAKEN when two concurrent creates race for the same slug", async () => {
    const userA = await seedUser(auth);
    const userB = await seedUser(auth);
    const bootA = await seedOrg(auth, userA.userId);
    const bootB = await seedOrg(auth, userB.userId);
    const callerA = createOperatorCaller(db, auth, userA.headers, bootA.orgId);
    const callerB = createOperatorCaller(db, auth, userB.headers, bootB.orgId);

    const slug = `race-${crypto.randomUUID().slice(0, 8)}`;

    const results = await Promise.allSettled([
      callerA.organizations.create({ name: "Racer A", slug }),
      callerB.organizations.create({ name: "Racer B", slug }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one race winner; the other must see SLUG_TAKEN.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    const err = rejection.reason as { code?: string; cause?: { code?: string } };
    expect(err.code).toBe("CONFLICT");
    expect(err.cause?.code).toBe("SLUG_TAKEN");

    // DB state: exactly one org with the raced slug.
    const orgRows = await db.select().from(organization).where(eq(organization.slug, slug));
    expect(orgRows.length).toBe(1);

    // Atomicity: the winner's default profile exists.
    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, orgRows[0]?.id ?? ""));
    expect(profileRows.length).toBe(1);
    expect(profileRows[0]?.name).toBe("default");
  });

  test("pre-check slug collision returns SLUG_TAKEN (non-racing path)", async () => {
    const userA = await seedUser(auth);
    const userB = await seedUser(auth);
    const bootA = await seedOrg(auth, userA.userId);
    const bootB = await seedOrg(auth, userB.userId);
    const callerA = createOperatorCaller(db, auth, userA.headers, bootA.orgId);
    const callerB = createOperatorCaller(db, auth, userB.headers, bootB.orgId);

    await callerA.organizations.create({ name: "First", slug: "taken" });

    try {
      await callerB.organizations.create({ name: "Second", slug: "taken" });
      expect.unreachable("duplicate slug should have thrown");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("CONFLICT");
      expect(err.cause?.code).toBe("SLUG_TAKEN");
    }
  });
});

/**
 * `organizations.list` orders by `member.createdAt ASC` so the dashboard shows
 * orgs in a stable, earliest-joined-first order rather than Postgres heap
 * order. It also caps at 100 rows so a pathological user with hundreds of
 * memberships does not pay an unbounded scan on every page load.
 */
describe("organizations.list ordering + pagination", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("returns orgs ordered by member.createdAt ASC (earliest-joined first)", async () => {
    const user = await seedUser(auth);
    const org1 = await seedOrg(auth, user.userId, {
      slug: `first-${crypto.randomUUID().slice(0, 6)}`,
    });
    const org2 = await seedOrg(auth, user.userId, {
      slug: `second-${crypto.randomUUID().slice(0, 6)}`,
    });
    const org3 = await seedOrg(auth, user.userId, {
      slug: `third-${crypto.randomUUID().slice(0, 6)}`,
    });

    // Helpers set `created_at = now()`; rapid back-to-back inserts may collide
    // at millisecond resolution. Stamp explicit, staggered timestamps so the
    // ORDER BY assertion is deterministic regardless of clock skew.
    const base = Date.now();
    await db
      .update(member)
      .set({ createdAt: new Date(base) })
      .where(and(eq(member.organizationId, org1.orgId), eq(member.userId, user.userId)));
    await db
      .update(member)
      .set({ createdAt: new Date(base + 1000) })
      .where(and(eq(member.organizationId, org2.orgId), eq(member.userId, user.userId)));
    await db
      .update(member)
      .set({ createdAt: new Date(base + 2000) })
      .where(and(eq(member.organizationId, org3.orgId), eq(member.userId, user.userId)));

    const caller = createOperatorCaller(db, auth, user.headers, org1.orgId);
    const result = await caller.organizations.list();

    expect(result.organizations).toHaveLength(3);
    expect(result.organizations.map((o: { id: string }) => o.id)).toEqual([
      org1.orgId,
      org2.orgId,
      org3.orgId,
    ]);
  });

  // TODO: verifying the 100-row cap empirically would require seeding 101 orgs
  // per user, which is prohibitively expensive for the integration suite. The
  // cap is enforced as a constant passed to `.limit()` in `listOrgs`; the
  // behavior is obvious from the query and covered by inspection.
});
