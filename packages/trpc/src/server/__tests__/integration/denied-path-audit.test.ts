/**
 * Denied-path audit coverage (W2T12-003 / B32)
 *
 * Verifies that every authorization denial in session-procedure routers writes
 * a denied audit row BEFORE throwing the domain error. Product invariant:
 * "Every allowed and denied agent access attempt must be logged."
 *
 * Scenarios:
 *   1. Member creates permission (insufficient_role) → permission.create denied
 *   2. Member rotates another member's agent (agent_not_owned) → agent.rotate denied
 *   3. Agent.rotate on non-existent agent → agent.rotate denied, reason: not_found
 *   4. Non-owner tries to change a member's role → org.member_role_change denied
 *   5. Item not found in org (cross-org probe) → item.update denied, reason: not_found
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, desc, eq } from "@abadge/db";
import { auditLogs } from "@abadge/db/schema";
import {
  seedAgent,
  seedMember,
  seedOrg,
  seedProfile,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("denied-path audit (W2T12-003)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // ---------------------------------------------------------------------------
  // Scenario 1: Member cannot create a permission on another member's agent
  // ---------------------------------------------------------------------------
  test("member cannot create permission on others agent → denied audit row: permission.create", async () => {
    const owner = await seedUser(auth);
    const bob = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);
    await seedMember(auth, orgId, bob.userId, "member");

    const { profileId } = await seedProfile(db, orgId);
    const { itemId } = await seedServerItem(db, {
      userId: owner.userId,
      orgId,
      profileId,
    });
    // Agent is owned by owner, not bob
    const { agentId } = await seedAgent(db, { userId: owner.userId, orgId });

    const bobCaller = createOperatorCaller(db, auth, bob.headers, orgId);

    await expect(
      bobCaller.permissions.create({
        agentId,
        itemId,
        capability: "reveal_plaintext",
      }),
    ).rejects.toThrow();

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.eventType, "permission.create"), eq(auditLogs.result, "denied")))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);

    expect(audit).toBeDefined();
    expect(audit?.userId).toBe(bob.userId);
    expect(audit?.organizationId).toBe(orgId);
    // requireOrgRole("member") passes for bob; requireAgentOwnership fires
    const meta = audit?.meta as Record<string, unknown> | null;
    expect(meta?.reason).toBe("agent_not_owned");
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Member tries to rotate another member's agent
  // ---------------------------------------------------------------------------
  test("member cannot rotate another member's agent → denied audit row: agent.rotate", async () => {
    const owner = await seedUser(auth);
    const bob = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);
    await seedMember(auth, orgId, bob.userId, "member");

    // Agent created by owner with legacy_api_key so rotation is possible in principle
    const { agentId } = await seedAgent(db, {
      userId: owner.userId,
      orgId,
      authMethod: "legacy_api_key",
    });

    const bobCaller = createOperatorCaller(db, auth, bob.headers, orgId);

    await expect(bobCaller.agents.rotate({ agentId })).rejects.toThrow();

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.eventType, "agent.rotate"), eq(auditLogs.result, "denied")))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);

    expect(audit).toBeDefined();
    expect(audit?.userId).toBe(bob.userId);
    expect(audit?.organizationId).toBe(orgId);
    const meta = audit?.meta as Record<string, unknown> | null;
    expect(meta?.reason).toBe("agent_not_owned");
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Rotate on a non-existent agent (cross-org probe or stale ID)
  // ---------------------------------------------------------------------------
  test("rotate on non-existent agent → denied audit row: agent.rotate, reason: not_found", async () => {
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);

    const ownerCaller = createOperatorCaller(db, auth, owner.headers, orgId);
    const fakeAgentId = crypto.randomUUID();

    await expect(ownerCaller.agents.rotate({ agentId: fakeAgentId })).rejects.toThrow();

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.eventType, "agent.rotate"), eq(auditLogs.result, "denied")))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);

    expect(audit).toBeDefined();
    expect(audit?.userId).toBe(owner.userId);
    expect(audit?.organizationId).toBe(orgId);
    const meta = audit?.meta as Record<string, unknown> | null;
    expect(meta?.reason).toBe("not_found");
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Non-owner tries to change a member's role
  // ---------------------------------------------------------------------------
  test("admin cannot update member role → denied audit row: org.member_role_change", async () => {
    const owner = await seedUser(auth);
    const admin = await seedUser(auth);
    const targetMember = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);
    await seedMember(auth, orgId, admin.userId, "admin");
    await seedMember(auth, orgId, targetMember.userId, "member");

    // Look up target's member row id
    const { member: memberTable } = await import("@abadge/db/schema");
    const [targetMembership] = await db
      .select({ id: memberTable.id })
      .from(memberTable)
      .where(
        and(eq(memberTable.organizationId, orgId), eq(memberTable.userId, targetMember.userId)),
      );
    if (!targetMembership) throw new Error("member row not found");

    const adminCaller = createOperatorCaller(db, auth, admin.headers, orgId);

    await expect(
      adminCaller.organizations.members.updateRole({
        orgId,
        memberId: targetMembership.id,
        role: "owner",
      }),
    ).rejects.toThrow();

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.eventType, "org.member_role_change"), eq(auditLogs.result, "denied")))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);

    expect(audit).toBeDefined();
    expect(audit?.userId).toBe(admin.userId);
    expect(audit?.organizationId).toBe(orgId);
    const meta = audit?.meta as Record<string, unknown> | null;
    expect(meta?.reason).toBe("insufficient_role");
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Item update on a non-existent item (cross-org probe)
  // ---------------------------------------------------------------------------
  test("update on non-existent item → denied audit row: item.update, reason: not_found", async () => {
    const owner = await seedUser(auth);
    const { orgId } = await seedOrg(auth, owner.userId);

    const ownerCaller = createOperatorCaller(db, auth, owner.headers, orgId);
    const fakeItemId = crypto.randomUUID();

    await expect(
      ownerCaller.items.update({
        itemId: fakeItemId,
        data: {
          storageMode: "server_managed",
          contentVersion: 1,
          payload: {
            v: 1,
            label: "test",
            kind: "opaque",
            tags: [],
            fields: { value: "secret" },
          },
        },
      }),
    ).rejects.toThrow();

    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.eventType, "item.update"), eq(auditLogs.result, "denied")))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);

    expect(audit).toBeDefined();
    expect(audit?.userId).toBe(owner.userId);
    expect(audit?.organizationId).toBe(orgId);
    const meta = audit?.meta as Record<string, unknown> | null;
    expect(meta?.reason).toBe("not_found");
  });
});
