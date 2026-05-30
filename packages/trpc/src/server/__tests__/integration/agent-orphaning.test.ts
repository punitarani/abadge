import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { agentSessions, agents, auditLogs, permissions, user } from "@abadge/db/schema";
import { requireAgentOwnership } from "../../init";
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
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// Agent-lifecycle entities are org-scoped, not user-scoped. Deleting the
// user who created an agent must ORPHAN it (createdBy -> NULL via FK SET NULL), not
// cascade-delete it; the agent, its grants, and its sessions keep working.
describe("agent lifecycle survives creating-user deletion", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // An org owner (who survives) plus a separate "creator" member who owns the agent,
  // so deleting the creator exercises orphaning without tearing down the org itself.
  async function seedOrphanScenario() {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const creator = await seedUser(auth);
    await seedMember(auth, org.orgId, creator.userId, "member");

    const agent = await seedAgent(db, { userId: creator.userId, orgId: org.orgId, kind: "remote" });
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const permission = await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: creator.userId,
    });
    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: creator.userId });
    return { owner, org, creator, agent, item, permission, session };
  }

  test("deleting the creating user orphans (does not delete) the agent — createdBy becomes null", async () => {
    const s = await seedOrphanScenario();
    await db.delete(user).where(eq(user.id, s.creator.userId));

    const [row] = await db
      .select({ id: agents.id, createdBy: agents.createdBy })
      .from(agents)
      .where(eq(agents.id, s.agent.agentId));

    expect(row).toBeDefined();
    expect(row?.createdBy).toBeNull();
  });

  test("the orphaned agent's permission survives, with grantedBy set to null", async () => {
    const s = await seedOrphanScenario();
    await db.delete(user).where(eq(user.id, s.creator.userId));

    const [row] = await db
      .select({ id: permissions.id, grantedBy: permissions.grantedBy })
      .from(permissions)
      .where(eq(permissions.id, s.permission.permissionId));

    expect(row).toBeDefined();
    expect(row?.grantedBy).toBeNull();
  });

  test("a previously-issued agent session survives user deletion, with userId set to null", async () => {
    const s = await seedOrphanScenario();
    await db.delete(user).where(eq(user.id, s.creator.userId));

    const [row] = await db
      .select({ id: agentSessions.id, userId: agentSessions.userId })
      .from(agentSessions)
      .where(eq(agentSessions.id, s.session.sessionId));

    expect(row).toBeDefined();
    expect(row?.userId).toBeNull();
  });

  test("the orphaned agent keeps working: its session validates and it lists its permitted items", async () => {
    const s = await seedOrphanScenario();
    await db.delete(user).where(eq(user.id, s.creator.userId));

    // Session validation must tolerate a null createdBy / null session userId (the type
    // cascade would otherwise pass the typecheck while SQL `NULL = NULL` silently rejected
    // every orphaned session). The surviving permission still grants the agent its item.
    const agentCaller = createAgentCaller(db, auth, s.session.rawToken);
    const result = await agentCaller.items.listForAgent({});

    expect(result.items.map((i: { id: string }) => i.id)).toContain(s.item.itemId);
  });

  test("an orphaned agent's actions are still auditable (userId null) and visible to it", async () => {
    const s = await seedOrphanScenario();
    await db.delete(user).where(eq(user.id, s.creator.userId));

    // The "every access is logged" invariant must hold for orphaned agents: a row with a
    // null actor-user is writable (column is nullable) and retrievable.
    await db.insert(auditLogs).values({
      organizationId: s.org.orgId,
      userId: null,
      agentId: s.agent.agentId,
      eventType: "item.read",
      result: "allowed",
    });

    // The agent's own audit query (non-admin path) must surface its ownerless rows via the
    // isNull branch — `eq(userId, null)` would match nothing under SQL three-valued logic.
    const agentCaller = createAgentCaller(db, auth, s.session.rawToken);
    const audit = await agentCaller.audit.listForAgent({});

    expect(
      audit.entries.some(
        (e: { agentId: string | null; userId: string | null }) =>
          e.agentId === s.agent.agentId && e.userId === null,
      ),
    ).toBe(true);
  });

  test("after orphaning, an admin can still manage the agent but a non-creating member cannot", async () => {
    const s = await seedOrphanScenario();
    await db.delete(user).where(eq(user.id, s.creator.userId));

    // Admins manage any agent regardless of the now-null createdBy (early role short-circuit).
    await requireAgentOwnership(db, s.agent.agentId, s.owner.userId, s.org.orgId, "admin");

    // A member who did not create the (now ownerless) agent gets a clean Forbidden, not a crash.
    const member = await seedUser(auth);
    await seedMember(auth, s.org.orgId, member.userId, "member");

    let code: string | undefined;
    try {
      await requireAgentOwnership(db, s.agent.agentId, member.userId, s.org.orgId, "member");
      expect.unreachable("a non-creating member must not manage an orphaned agent");
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    expect(code).toBe("MEMBER_AGENT_OWNERSHIP");
  });

  test("after orphaning, an admin can revoke the orphaned session but a non-creating member cannot", async () => {
    const s = await seedOrphanScenario();
    await db.delete(user).where(eq(user.id, s.creator.userId));

    // A non-creating member is denied (an orphaned agent is admin-only to manage), and the
    // session must stay live — the deny path must not silently report success.
    const member = await seedUser(auth);
    await seedMember(auth, s.org.orgId, member.userId, "member");
    const memberCaller = createOperatorCaller(db, auth, member.headers, s.org.orgId);
    let memberErr: { cause?: { code?: string } } | undefined;
    try {
      await memberCaller.auth.revokeSession({ token: s.session.rawToken });
      expect.unreachable("a non-creating member must not revoke an orphaned session");
    } catch (err) {
      memberErr = err as { cause?: { code?: string } };
    }
    expect(memberErr?.cause?.code).toBe("MEMBER_AGENT_OWNERSHIP");

    // The owner (admin) revokes by token. Before the revoke fix this was a silent no-op: the
    // session's userId was SET NULL on user-delete, so a `userId = caller` filter matched nothing.
    const operatorCaller = createOperatorCaller(db, auth, s.owner.headers, s.org.orgId);
    await operatorCaller.auth.revokeSession({ token: s.session.rawToken });

    const [row] = await db
      .select({ revokedAt: agentSessions.revokedAt })
      .from(agentSessions)
      .where(eq(agentSessions.id, s.session.sessionId));
    expect(row?.revokedAt).not.toBeNull();
  });
});
