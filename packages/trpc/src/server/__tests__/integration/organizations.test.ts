import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
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
