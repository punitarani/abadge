import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import {
  agentSessions,
  agents,
  auditLogs,
  member,
  organization,
  permissions,
  profiles,
} from "@abadge/db/schema";
import { _resetGetInviteInfoRateLimit } from "../../routers/organizations";
import {
  seedAgent,
  seedAgentSession,
  seedMember,
  seedOrg,
  seedPermission,
  seedProfile,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * `organizations.create` tests cover:
 *   - atomicity: org + owner-member + default server_managed profile all
 *     succeed or fail together (§REVAMP-PR3 Task 5.1 — the default profile
 *     is auto-seeded so the org is immediately usable; the onboarding gate
 *     is removed in the same revamp)
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

  test("creates org + owner-member + default server_managed profile", async () => {
    const owner = await seedUser(auth);
    const bootstrap = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, bootstrap.orgId);

    const result = await caller.organizations.create({
      name: "Acme Inc",
      slug: "acme-ok",
    });

    expect(result.organization.slug).toBe("acme-ok");
    expect(result.organization.isPersonal).toBe(false);
    expect(result.defaultProfile.name).toBe("default");
    expect(result.defaultProfile.externalId).toBe("default");
    expect(result.defaultProfile.storageMode).toBe("server_managed");

    // Caller is registered as owner of the new org.
    const [ownerMember] = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, result.organization.id))
      .limit(1);
    expect(ownerMember?.userId).toBe(owner.userId);
    expect(ownerMember?.role).toBe("owner");

    // §REVAMP-PR3 Task 5.1 — exactly one auto-seeded server_managed profile
    // exists, with externalId="default" so external provisioning has a stable
    // handle. The org is immediately usable on first call.
    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, result.organization.id));
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0]?.id).toBe(result.defaultProfile.id);
    expect(profileRows[0]?.name).toBe("default");
    expect(profileRows[0]?.externalId).toBe("default");
    expect(profileRows[0]?.storageMode).toBe("server_managed");
    expect(profileRows[0]?.keyVersion).toBe(1);

    // Audit row carries `meta.autoDefaultProfile` so the seeded profile can be
    // traced back to the org-create event.
    const auditRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, result.organization.id),
          eq(auditLogs.eventType, "org.create"),
        ),
      );
    expect(auditRows).toHaveLength(1);
    const meta = auditRows[0]?.meta as { autoDefaultProfile?: string } | null;
    expect(meta?.autoDefaultProfile).toBe(result.defaultProfile.id);
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

    // DB state: exactly one org with the raced slug, with exactly one
    // auto-seeded default profile (the txn is atomic — winner gets a profile,
    // loser gets nothing).
    const orgRows = await db.select().from(organization).where(eq(organization.slug, slug));
    expect(orgRows.length).toBe(1);

    const profileRows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, orgRows[0]?.id ?? ""));
    expect(profileRows.length).toBe(1);
    expect(profileRows[0]?.externalId).toBe("default");
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
 * the overview or back to a "create your first profile" prompt without
 * paying an N+1 profiles.list per org.
 *
 * Definition (mirrors `isProfileBootstrapped` in apps/web/src/app/onboarding):
 *   - server_managed profile: always counted as bootstrapped
 *   - zero_knowledge profile: bootstrapped iff wrappedRootKey IS NOT NULL
 *
 * `organizations.create` no longer seeds a default profile, so a freshly-
 * created org has zero profiles and is unbootstrapped until `profiles.create`
 * (and, for ZK profiles, `profiles.bootstrap`) run.
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

    // org A: only an unbootstrapped zk profile (no wrappedRootKey) -> unbootstrapped
    // (opt out of seedOrg's default server_managed profile so this org's
    // state is controlled purely by the seedProfile call below.)
    const orgA = await seedOrg(auth, user.userId, {
      slug: `unboot-${crypto.randomUUID().slice(0, 6)}`,
      withDefaultProfile: false,
    });
    await seedProfile(db, orgA.orgId, { name: "default", storageMode: "zero_knowledge" });

    // org B: server_managed profile -> bootstrapped (no key needed)
    const orgB = await seedOrg(auth, user.userId, {
      slug: `srv-${crypto.randomUUID().slice(0, 6)}`,
      withDefaultProfile: false,
    });
    await seedProfile(db, orgB.orgId, { name: "default", storageMode: "server_managed" });

    // org C: zk profile WITH wrappedRootKey -> bootstrapped
    const orgC = await seedOrg(auth, user.userId, {
      slug: `boot-${crypto.randomUUID().slice(0, 6)}`,
      withDefaultProfile: false,
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

/**
 * `organizations.members.remove` runs three coupled writes — delete the member
 * row, write the `org.member_remove` audit, run the cascade (revoke agents,
 * invalidate sessions, delete granted permissions) — atomically inside a single
 * `ctx.db.transaction(...)`. Phase D's A3.1 fix flipped the cascade signature
 * to require a `Transaction` so the caller owns the boundary; this exercises
 * the integration end-to-end through the tRPC surface.
 */
describe("organizations.members.remove atomic cascade", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("removes member, writes primary audit, AND cascades agents/sessions/permissions atomically", async () => {
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);
    const removed = await seedUser(auth);
    await seedMember(auth, orgId, removed.userId, "admin");
    // seedMember does not return the membership id — look it up.
    const [removedMembership] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, removed.userId)));
    if (!removedMembership) throw new Error("seedMember did not insert a row");

    // The removed user CREATED an agent and was granted a live session for it.
    const memberAgent = await seedAgent(db, { userId: removed.userId, orgId });
    const memberSession = await seedAgentSession(db, {
      agentId: memberAgent.agentId,
      userId: removed.userId,
    });

    // The removed user GRANTED a permission to a third-party agent (the owner's).
    const ownerAgent = await seedAgent(db, { userId: owner.userId, orgId });
    const item = await seedServerItem(db, { userId: owner.userId, orgId });
    const removedGrant = await seedPermission(db, {
      orgId,
      agentId: ownerAgent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: removed.userId,
    });

    const ownerCaller = createOperatorCaller(db, auth, owner.headers, orgId);
    const result = await ownerCaller.organizations.members.remove({
      orgId,
      memberId: removedMembership.id,
    });
    expect(result.ok).toBe(true);

    // (1) Primary delete: the member row is gone.
    const remainingMembers = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.id, removedMembership.id));
    expect(remainingMembers).toHaveLength(0);

    // (2) Primary audit: org.member_remove landed.
    const primaryAudit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.organizationId, orgId), eq(auditLogs.eventType, "org.member_remove")),
      );
    expect(primaryAudit).toHaveLength(1);
    expect(primaryAudit[0]?.userId).toBe(owner.userId);
    expect((primaryAudit[0]?.meta as { removedUserId?: string })?.removedUserId).toBe(
      removed.userId,
    );

    // (3a) Cascade: removed member's agent was revoked.
    const [revokedAgent] = await db
      .select({ enabled: agents.enabled, revokedAt: agents.revokedAt })
      .from(agents)
      .where(eq(agents.id, memberAgent.agentId));
    expect(revokedAgent?.enabled).toBe(false);
    expect(revokedAgent?.revokedAt).not.toBeNull();

    // (3b) Cascade: the agent's live session was invalidated.
    const [revokedSession] = await db
      .select({ revokedAt: agentSessions.revokedAt })
      .from(agentSessions)
      .where(eq(agentSessions.id, memberSession.sessionId));
    expect(revokedSession?.revokedAt).not.toBeNull();

    // (3c) Cascade: the permission they GRANTED is gone.
    const remainingGrants = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.id, removedGrant.permissionId));
    expect(remainingGrants).toHaveLength(0);

    // (3d) Cascade audits: agent.revoke_cascade + permission.revoke_cascade.
    const cascadeAudits = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), eq(auditLogs.result, "cascade")));
    const cascadeEventTypes = cascadeAudits.map((row) => row.eventType).sort();
    expect(cascadeEventTypes).toContain("agent.revoke_cascade");
    expect(cascadeEventTypes).toContain("permission.revoke_cascade");
  });
});
