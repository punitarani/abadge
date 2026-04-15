import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { member, organization, profiles } from "@abadge/db/schema";
import { _resetGetInviteInfoRateLimit } from "../../routers/organizations";
import { seedMember, seedOrg, seedProfile, seedUser } from "../helpers/seed";
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

/**
 * `organizations.list` carries a `hasBootstrappedProfile` boolean per org so
 * the dashboard's onboarding-resume flow can decide whether to redirect to
 * /overview or back to step 2 without paying an N+1 profiles.list per org.
 *
 * Definition (mirrors `isProfileBootstrapped` in apps/web/src/app/onboarding):
 *   - server_managed profile: always counted as bootstrapped
 *   - zero_knowledge profile: bootstrapped iff wrappedRootKey IS NOT NULL
 *
 * `organizations.create` auto-creates a default zero_knowledge profile with
 * wrappedRootKey == null, so a freshly-created org is unbootstrapped until
 * `profiles.bootstrap` runs.
 */
describe("organizations.list hasBootstrappedProfile flag", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("flag reflects per-org bootstrap state across all profile shapes", async () => {
    const user = await seedUser(auth);

    // org A: only the auto-created zk-no-root profile -> unbootstrapped
    const orgA = await seedOrg(auth, user.userId, {
      slug: `unboot-${crypto.randomUUID().slice(0, 6)}`,
    });
    await seedProfile(db, orgA.orgId, { name: "default", storageMode: "zero_knowledge" });

    // org B: server_managed profile -> bootstrapped (no key needed)
    const orgB = await seedOrg(auth, user.userId, {
      slug: `srv-${crypto.randomUUID().slice(0, 6)}`,
    });
    await seedProfile(db, orgB.orgId, { name: "default", storageMode: "server_managed" });

    // org C: zk profile WITH wrappedRootKey -> bootstrapped
    const orgC = await seedOrg(auth, user.userId, {
      slug: `boot-${crypto.randomUUID().slice(0, 6)}`,
    });
    const { profileId: profileC } = await seedProfile(db, orgC.orgId, {
      name: "default",
      storageMode: "zero_knowledge",
    });
    await db
      .update(profiles)
      .set({ wrappedRootKey: "fake-wrapped-key", kdfSalt: "fake-salt" })
      .where(eq(profiles.id, profileC));

    const caller = createOperatorCaller(db, auth, user.headers, orgA.orgId);
    const result = (await caller.organizations.list()) as {
      organizations: Array<{ id: string; hasBootstrappedProfile: boolean }>;
    };

    const byId = new Map(result.organizations.map((o) => [o.id, o]));
    expect(byId.get(orgA.orgId)?.hasBootstrappedProfile).toBe(false);
    expect(byId.get(orgB.orgId)?.hasBootstrappedProfile).toBe(true);
    expect(byId.get(orgC.orgId)?.hasBootstrappedProfile).toBe(true);
  });
});

/**
 * `organizations.members.list` used to return every member's email to every
 * caller — a plain `member` could enumerate the org's entire contact list.
 * The fix gates `email` on the caller's role: owners and admins see emails,
 * plain members receive `email: null` for every row (including their own —
 * strict policy; users read their own email elsewhere).
 */
describe("organizations.members.list role-gated email", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("returns email when caller is owner", async () => {
    const owner = await seedUser(auth);
    const plainMember = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);
    await seedMember(auth, orgId, plainMember.userId, "member");

    const caller = createOperatorCaller(db, auth, owner.headers, orgId);
    const result = await caller.organizations.members.list({ orgId });

    expect(result.members).toHaveLength(2);
    const emails = result.members.map((m: { email: string | null }) => m.email).sort();
    expect(emails).toEqual([owner.email, plainMember.email].sort());
    // Sanity: nobody's email is null for an owner caller.
    for (const m of result.members) {
      expect(m.email).not.toBeNull();
    }
  });

  test("returns email when caller is admin", async () => {
    const owner = await seedUser(auth);
    const admin = await seedUser(auth);
    const plainMember = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);
    await seedMember(auth, orgId, admin.userId, "admin");
    await seedMember(auth, orgId, plainMember.userId, "member");

    const caller = createOperatorCaller(db, auth, admin.headers, orgId);
    const result = await caller.organizations.members.list({ orgId });

    expect(result.members).toHaveLength(3);
    for (const m of result.members) {
      expect(m.email).not.toBeNull();
    }
    const emails = new Set(result.members.map((m: { email: string | null }) => m.email));
    expect(emails.has(owner.email)).toBe(true);
    expect(emails.has(admin.email)).toBe(true);
    expect(emails.has(plainMember.email)).toBe(true);
  });

  test("returns email: null for every row when caller is plain member", async () => {
    const owner = await seedUser(auth);
    const plainMember = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);
    await seedMember(auth, orgId, plainMember.userId, "member");

    const caller = createOperatorCaller(db, auth, plainMember.headers, orgId);
    const result = await caller.organizations.members.list({ orgId });

    expect(result.members).toHaveLength(2);
    // Strict policy: the caller's own email is withheld too. Users can read
    // their own email from their profile/settings, not the members list.
    for (const m of result.members) {
      expect(m.email).toBeNull();
    }
    // The other fields still come back — only `email` is gated.
    const userIds = result.members.map((m: { userId: string }) => m.userId).sort();
    expect(userIds).toEqual([owner.userId, plainMember.userId].sort());
  });
});

/**
 * `organizations.members.getInviteInfo` is callable by any authenticated user
 * with a token. Without a tighter cap, a determined attacker could enumerate
 * valid invite tokens at the wider 100/min tRPC limit. The procedure applies
 * a per-(user, IP) cap of 10/min; the 11th call within the window must fail
 * with RATE_LIMITED.
 */
describe("organizations.members.getInviteInfo rate limit", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    _resetGetInviteInfoRateLimit();
    await truncateAll();
  });

  test("rejects after 10 getInviteInfo calls within the window", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, orgId);

    // First 10 calls burn the budget. Each one has a bogus token so the
    // procedure will ultimately throw — we only assert that it is NOT the
    // rate-limit error. The outcome of the lookup itself is covered by the
    // accept-invite flow elsewhere; here we just need to exercise the
    // counter ten times.
    for (let i = 0; i < 10; i++) {
      try {
        await caller.organizations.members.getInviteInfo({ token: `abi_bogus_${i}` });
        // Bogus token: a non-throwing result would itself be a bug, but let
        // the assertion below catch the "wrong-error" case either way.
      } catch (error: unknown) {
        const err = error as { code?: string; cause?: { code?: string } };
        expect(err.cause?.code).not.toBe("RATE_LIMITED");
      }
    }

    // The 11th call must be refused with RATE_LIMITED before hitting the DB.
    try {
      await caller.organizations.members.getInviteInfo({ token: "abi_bogus_final" });
      expect.unreachable("rate limit should have refused the 11th call");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("TOO_MANY_REQUESTS");
      expect(err.cause?.code).toBe("RATE_LIMITED");
    }
  });

  test("counter resets after the window expires", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId);
    const caller = createOperatorCaller(db, auth, user.headers, orgId);

    // Burn the budget.
    for (let i = 0; i < 10; i++) {
      await caller.organizations.members
        .getInviteInfo({ token: `abi_bogus_${i}` })
        .catch(() => undefined);
    }

    // Confirm we hit the limit.
    await expect(
      caller.organizations.members.getInviteInfo({ token: "abi_bogus_11" }),
    ).rejects.toMatchObject({ cause: { code: "RATE_LIMITED" } });

    // Resetting the counter (as happens at window rollover) clears the limit.
    _resetGetInviteInfoRateLimit();

    // The next call is allowed through — it will still fail on lookup, but
    // with a non-rate-limit error.
    try {
      await caller.organizations.members.getInviteInfo({ token: "abi_bogus_after_reset" });
    } catch (error: unknown) {
      const err = error as { cause?: { code?: string } };
      expect(err.cause?.code).not.toBe("RATE_LIMITED");
    }
  });
});
