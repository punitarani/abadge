import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { agentSessions, auditLogs } from "@abadge/db/schema";
import { seedAgent, seedAgentSession, seedOrg, seedServerItem, seedUser } from "../helpers/seed";
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
