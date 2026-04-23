import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { member } from "@abadge/db/schema";
import { seedMember, seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { TEST_ENV } from "../helpers/test-env";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * Better Auth org-plugin RBAC tests (W3P8-001)
 *
 * Verifies that the custom adminAc (member: ["create","delete"], no "update")
 * blocks the /api/auth/organization/update-member-role HTTP endpoint for
 * admin callers. All role mutations must go through abadge's tRPC
 * updateMemberRole (owner-only).
 */
describe("Better Auth org-plugin RBAC (W3P8-001)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);
  const baseUrl = TEST_ENV.ABADGE_API_URL;

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("admin cannot promote member to admin via /api/auth/organization/update-member-role", async () => {
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId, {
      name: "RBAC Org",
      slug: `rbac-org-${crypto.randomUUID()}`,
    });

    // Add alice as admin (seeded directly — simulates a previous owner-promoted admin).
    const alice = await seedUser(auth);
    await seedMember(auth, orgId, alice.userId, "admin");

    // Add bob as plain member.
    const bob = await seedUser(auth);
    await seedMember(auth, orgId, bob.userId, "member");

    // Find bob's member row ID.
    const [bobRow] = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(eq(member.userId, bob.userId));
    expect(bobRow).toBeDefined();
    const bobMemberId = bobRow!.id;

    // Alice (admin) fires the Better Auth HTTP endpoint to promote bob to admin.
    // Build the headers by forwarding alice's session headers then setting content-type.
    const reqHeaders = new Headers(alice.headers);
    reqHeaders.set("content-type", "application/json");
    const req = new Request(
      `${baseUrl}/api/auth/organization/update-member-role`,
      {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({
          memberId: bobMemberId,
          role: "admin",
          organizationId: orgId,
        }),
      },
    );

    const res = await auth.handler(req);
    expect(res.status).toBe(403);

    // DB must be unchanged — bob is still "member".
    const [bobAfter] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.id, bobMemberId));
    expect(bobAfter?.role).toBe("member");
  });

  test("owner CAN promote member to admin via /api/auth/organization/update-member-role", async () => {
    // Sanity: the ownerAc still has member:["update"], so the owner path remains open
    // (abadge's tRPC updateMemberRole is the preferred owner path, but the Better Auth
    // plugin route should also work for owners).
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId, {
      name: "RBAC Owner Org",
      slug: `rbac-owner-${crypto.randomUUID()}`,
    });

    const bob = await seedUser(auth);
    await seedMember(auth, orgId, bob.userId, "member");

    const [bobRow] = await db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(eq(member.userId, bob.userId));
    const bobMemberId = bobRow!.id;

    const ownerReqHeaders = new Headers(owner.headers);
    ownerReqHeaders.set("content-type", "application/json");
    const req = new Request(
      `${baseUrl}/api/auth/organization/update-member-role`,
      {
        method: "POST",
        headers: ownerReqHeaders,
        body: JSON.stringify({
          memberId: bobMemberId,
          role: "admin",
          organizationId: orgId,
        }),
      },
    );

    const res = await auth.handler(req);
    expect(res.status).toBe(200);

    const [bobAfter] = await db
      .select({ role: member.role })
      .from(member)
      .where(eq(member.id, bobMemberId));
    expect(bobAfter?.role).toBe("admin");
  });
});
