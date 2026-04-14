import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { agentSessions, agents, auditLogs, permissions } from "@abadge/db/schema";
import { onMemberRemoved } from "../../cascades";
import {
  seedAgent,
  seedAgentSession,
  seedMember,
  seedOrg,
  seedPermission,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("cascade behavior", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("revoking an agent invalidates its active sessions", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // Seed agent via helper (inserts into both principals and agents tables)
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      name: "cascade-agent",
      kind: "remote",
      authMethod: "legacy_api_key",
    });

    // Create two active sessions for the agent
    const session1 = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });

    const session2 = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });

    // Revoke the agent via the tRPC router
    await caller.agents.revoke({ agentId: agent.agentId });

    // Verify both sessions have revokedAt set
    const [row1] = await db
      .select({ revokedAt: agentSessions.revokedAt })
      .from(agentSessions)
      .where(eq(agentSessions.id, session1.sessionId))
      .limit(1);

    const [row2] = await db
      .select({ revokedAt: agentSessions.revokedAt })
      .from(agentSessions)
      .where(eq(agentSessions.id, session2.sessionId))
      .limit(1);

    expect(row1?.revokedAt).toBeTruthy();
    expect(row2?.revokedAt).toBeTruthy();

    // Verify cascade audit entries exist (eventType: "agent.revoke" with result: "cascade")
    const cascadeEntries = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.agentId, agent.agentId), eq(auditLogs.result, "cascade")));

    expect(cascadeEntries.length).toBeGreaterThanOrEqual(2);
  });

  test("deleting an item writes cascade audit entry", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // Seed a server_managed item directly
    const seeded = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      label: "cascade-item",
    });

    // Delete the item via the tRPC router
    await caller.items.delete({ itemId: seeded.itemId });

    // Verify cascade audit entry with eventType: "item.delete_cascade"
    const cascadeEntries = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.itemId, seeded.itemId),
          eq(auditLogs.eventType, "item.delete_cascade"),
          eq(auditLogs.result, "cascade"),
        ),
      );

    expect(cascadeEntries.length).toBeGreaterThanOrEqual(1);
  });
});

describe("onMemberRemoved cascade (real revocation)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("disables agents the removed member created", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const removed = await seedUser(auth);
    await seedMember(auth, org.orgId, removed.userId, "member");

    const agentA = await seedAgent(db, { userId: removed.userId, orgId: org.orgId });
    const agentB = await seedAgent(db, { userId: removed.userId, orgId: org.orgId });

    await onMemberRemoved(db, org.orgId, removed.userId, owner.userId);

    const rows = await db
      .select({ id: agents.id, enabled: agents.enabled, revokedAt: agents.revokedAt })
      .from(agents)
      .where(eq(agents.organizationId, org.orgId));

    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.enabled).toBe(false);
      expect(row.revokedAt).toBeTruthy();
    }
    // Belt-and-braces: neither agent slipped through.
    expect(rows.map((r) => r.id).sort()).toEqual([agentA.agentId, agentB.agentId].sort());
  });

  test("invalidates active agent sessions for the removed member's agents", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const removed = await seedUser(auth);
    await seedMember(auth, org.orgId, removed.userId, "member");

    const agent = await seedAgent(db, { userId: removed.userId, orgId: org.orgId });

    const active1 = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: removed.userId,
    });
    const active2 = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: removed.userId,
    });

    // Pre-revoked session: its revokedAt must not be overwritten.
    const preRevokedAt = new Date(Date.now() - 60_000);
    const preRevoked = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: removed.userId,
      revokedAt: preRevokedAt,
    });

    await onMemberRemoved(db, org.orgId, removed.userId, owner.userId);

    const [row1] = await db
      .select({ revokedAt: agentSessions.revokedAt })
      .from(agentSessions)
      .where(eq(agentSessions.id, active1.sessionId));
    const [row2] = await db
      .select({ revokedAt: agentSessions.revokedAt })
      .from(agentSessions)
      .where(eq(agentSessions.id, active2.sessionId));
    const [rowPre] = await db
      .select({ revokedAt: agentSessions.revokedAt })
      .from(agentSessions)
      .where(eq(agentSessions.id, preRevoked.sessionId));

    expect(row1?.revokedAt).toBeTruthy();
    expect(row2?.revokedAt).toBeTruthy();
    expect(rowPre?.revokedAt?.getTime()).toBe(preRevokedAt.getTime());
  });

  test("deletes permissions the removed member granted; preserves others", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const removed = await seedUser(auth);
    await seedMember(auth, org.orgId, removed.userId, "member");

    // Agent/item owned by the org; the removed member is not the agent's creator here.
    const agent = await seedAgent(db, { userId: owner.userId, orgId: org.orgId });
    const item1 = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const item2 = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const item3 = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });

    const removedGrant1 = await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item1.itemId,
      capability: "reveal_plaintext",
      grantedBy: removed.userId,
    });
    const removedGrant2 = await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item2.itemId,
      capability: "reveal_plaintext",
      grantedBy: removed.userId,
    });
    const ownerGrant = await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item3.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    await onMemberRemoved(db, org.orgId, removed.userId, owner.userId);

    const remaining = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.organizationId, org.orgId));

    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(removedGrant1.permissionId);
    expect(ids).not.toContain(removedGrant2.permissionId);
    expect(ids).toContain(ownerGrant.permissionId);
  });

  test("writes one cascade audit row per revoked agent and per deleted permission, threading ipAddress", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const removed = await seedUser(auth);
    await seedMember(auth, org.orgId, removed.userId, "member");

    // Two agents created by the removed member.
    const _agentA = await seedAgent(db, { userId: removed.userId, orgId: org.orgId });
    const _agentB = await seedAgent(db, { userId: removed.userId, orgId: org.orgId });

    // A separate agent owned by the owner — used as the target of the removed member's grants.
    const targetAgent = await seedAgent(db, { userId: owner.userId, orgId: org.orgId });
    const item1 = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const item2 = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const item3 = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });

    await seedPermission(db, {
      orgId: org.orgId,
      agentId: targetAgent.agentId,
      itemId: item1.itemId,
      capability: "reveal_plaintext",
      grantedBy: removed.userId,
    });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: targetAgent.agentId,
      itemId: item2.itemId,
      capability: "mount_env",
      grantedBy: removed.userId,
    });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: targetAgent.agentId,
      itemId: item3.itemId,
      capability: "mount_file",
      grantedBy: removed.userId,
    });

    const ip = "203.0.113.42";
    await onMemberRemoved(db, org.orgId, removed.userId, owner.userId, ip);

    const agentCascades = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.orgId),
          eq(auditLogs.eventType, "agent.revoke_cascade"),
          eq(auditLogs.result, "cascade"),
        ),
      );
    expect(agentCascades.length).toBe(2);

    const permCascades = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.organizationId, org.orgId),
          eq(auditLogs.eventType, "permission.revoke_cascade"),
          eq(auditLogs.result, "cascade"),
        ),
      );
    expect(permCascades.length).toBe(3);

    for (const row of [...agentCascades, ...permCascades]) {
      const meta = row.meta as Record<string, unknown>;
      expect(meta?.trigger).toBe("member_remove");
      expect(meta?.removedUserId).toBe(removed.userId);
      expect(row.ipAddress).toBe(ip);
      expect(row.userId).toBe(owner.userId);
    }
  });

  test("is idempotent for a member with no agents or permissions", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const removed = await seedUser(auth);
    await seedMember(auth, org.orgId, removed.userId, "member");

    await onMemberRemoved(db, org.orgId, removed.userId, owner.userId);

    const cascades = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org.orgId), eq(auditLogs.result, "cascade")));

    expect(cascades.length).toBe(0);
  });
});
