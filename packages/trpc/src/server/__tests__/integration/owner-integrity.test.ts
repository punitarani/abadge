import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { member } from "@abadge/db/schema";
import { seedMember, seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * Owner-role integrity guards (§OWN1 §OWN2 §INV1a B37)
 *
 * Covers:
 *   §INV1a — admin cannot mint an owner-role invite (privilege escalation via
 *             invite-accept round-trip)
 *   §OWN1  — sole owner cannot self-demote via updateMemberRole (last-owner strand)
 *   §OWN2  — admin cannot remove an owner; sole owner cannot remove themselves
 *   B37    — last-owner stranding (subset of §OWN1/§OWN2)
 */
describe("owner-role integrity guards (§OWN1 §OWN2 §INV1a B37)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // ---------------------------------------------------------------------------
  // §INV1a — invite role cap
  // ---------------------------------------------------------------------------

  describe("§INV1a — createInvite role cap", () => {
    test("admin cannot mint an owner-role invite → 403 MEMBER_INSUFFICIENT_ROLE", async () => {
      const owner = await seedUser(auth);
      const admin = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);
      await seedMember(auth, orgId, admin.userId, "admin");

      const caller = createOperatorCaller(db, auth, admin.headers, orgId);

      try {
        await caller.organizations.members.invite({ orgId, role: "owner" });
        expect.unreachable("should have thrown MEMBER_INSUFFICIENT_ROLE");
      } catch (error: unknown) {
        const err = error as { code?: string; cause?: { code?: string } };
        expect(err.code).toBe("FORBIDDEN");
        expect(err.cause?.code).toBe("MEMBER_INSUFFICIENT_ROLE");
      }
    });

    test("admin can mint an admin-role invite → 200", async () => {
      const owner = await seedUser(auth);
      const admin = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);
      await seedMember(auth, orgId, admin.userId, "admin");

      const caller = createOperatorCaller(db, auth, admin.headers, orgId);
      const result = await caller.organizations.members.invite({ orgId, role: "admin" });
      expect(result.ok).toBe(true);
      expect(result.token).toBeTruthy();
    });

    test("owner can mint an owner-role invite → 200", async () => {
      const owner = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);

      const caller = createOperatorCaller(db, auth, owner.headers, orgId);
      const result = await caller.organizations.members.invite({ orgId, role: "owner" });
      expect(result.ok).toBe(true);
      expect(result.token).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // §OWN1 / B37 — last-owner demote block (updateMemberRole)
  // ---------------------------------------------------------------------------

  describe("§OWN1 — updateMemberRole last-owner block", () => {
    test("sole owner cannot self-demote to member → 409 CONFLICT", async () => {
      const owner = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);

      // Look up the owner's member row id
      const [ownerMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, owner.userId)));
      if (!ownerMembership) throw new Error("owner membership row not found");

      const caller = createOperatorCaller(db, auth, owner.headers, orgId);

      try {
        await caller.organizations.members.updateRole({
          orgId,
          memberId: ownerMembership.id,
          role: "member",
        });
        expect.unreachable("should have thrown CONFLICT");
      } catch (error: unknown) {
        const err = error as { code?: string; cause?: { code?: string } };
        expect(err.code).toBe("CONFLICT");
        expect(err.cause?.code).toBe("CONFLICT");
      }
    });

    test("self-demote succeeds after promoting another member to owner", async () => {
      const owner = await seedUser(auth);
      const newOwner = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);
      await seedMember(auth, orgId, newOwner.userId, "member");

      // Look up both member row ids
      const [ownerMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, owner.userId)));
      const [newOwnerMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, newOwner.userId)));
      if (!ownerMembership || !newOwnerMembership) throw new Error("membership row not found");

      const caller = createOperatorCaller(db, auth, owner.headers, orgId);

      // Promote the second user to owner first
      await caller.organizations.members.updateRole({
        orgId,
        memberId: newOwnerMembership.id,
        role: "owner",
      });

      // Now the original owner can safely self-demote
      const result = await caller.organizations.members.updateRole({
        orgId,
        memberId: ownerMembership.id,
        role: "member",
      });
      expect(result.ok).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // §OWN2 / B37 — last-owner remove block + admin-cannot-remove-owner
  // ---------------------------------------------------------------------------

  describe("§OWN2 — removeMember owner guards", () => {
    test("sole owner cannot remove themselves → 409 CONFLICT", async () => {
      const owner = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);

      const [ownerMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, owner.userId)));
      if (!ownerMembership) throw new Error("owner membership row not found");

      const caller = createOperatorCaller(db, auth, owner.headers, orgId);

      try {
        await caller.organizations.members.remove({ orgId, memberId: ownerMembership.id });
        expect.unreachable("should have thrown CONFLICT");
      } catch (error: unknown) {
        const err = error as { code?: string; cause?: { code?: string } };
        expect(err.code).toBe("CONFLICT");
        expect(err.cause?.code).toBe("CONFLICT");
      }
    });

    test("sole owner can remove themselves after promoting another to owner", async () => {
      const owner = await seedUser(auth);
      const newOwner = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);
      await seedMember(auth, orgId, newOwner.userId, "member");

      const [ownerMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, owner.userId)));
      const [newOwnerMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, newOwner.userId)));
      if (!ownerMembership || !newOwnerMembership) throw new Error("membership row not found");

      const caller = createOperatorCaller(db, auth, owner.headers, orgId);

      // Promote second user to owner first
      await caller.organizations.members.updateRole({
        orgId,
        memberId: newOwnerMembership.id,
        role: "owner",
      });

      // Now the original owner can remove themselves
      const result = await caller.organizations.members.remove({
        orgId,
        memberId: ownerMembership.id,
      });
      expect(result.ok).toBe(true);
    });

    test("admin cannot remove an owner → 403 MEMBER_INSUFFICIENT_ROLE", async () => {
      const owner = await seedUser(auth);
      const admin = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);
      await seedMember(auth, orgId, admin.userId, "admin");

      const [ownerMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, owner.userId)));
      if (!ownerMembership) throw new Error("owner membership row not found");

      const adminCaller = createOperatorCaller(db, auth, admin.headers, orgId);

      try {
        await adminCaller.organizations.members.remove({ orgId, memberId: ownerMembership.id });
        expect.unreachable("should have thrown MEMBER_INSUFFICIENT_ROLE");
      } catch (error: unknown) {
        const err = error as { code?: string; cause?: { code?: string } };
        expect(err.code).toBe("FORBIDDEN");
        expect(err.cause?.code).toBe("MEMBER_INSUFFICIENT_ROLE");
      }
    });

    test("admin can remove another admin → 200", async () => {
      const owner = await seedUser(auth);
      const admin = await seedUser(auth);
      const adminToRemove = await seedUser(auth);
      const { orgId } = await seedOrg(auth, owner.userId);
      await seedMember(auth, orgId, admin.userId, "admin");
      await seedMember(auth, orgId, adminToRemove.userId, "admin");

      const [adminToRemoveMembership] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, adminToRemove.userId)));
      if (!adminToRemoveMembership) throw new Error("member row not found");

      const adminCaller = createOperatorCaller(db, auth, admin.headers, orgId);
      const result = await adminCaller.organizations.members.remove({
        orgId,
        memberId: adminToRemoveMembership.id,
      });
      expect(result.ok).toBe(true);
    });
  });
});
