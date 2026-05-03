import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("audit log integration", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("every access attempt is logged (allowed and denied)", async () => {
    // Setup: user, org, server item, remote agent, session
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const { itemId } = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      fields: { secret: "audit-test" },
    });

    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
      name: "audit-bot",
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });

    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // Denied: no permission yet
    try {
      await agentCaller.access.reveal({ itemId });
    } catch {
      // expected — no permission
    }

    // Grant permission
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    // Allowed: permission now exists
    await agentCaller.access.reveal({ itemId });

    // Query audit log via operator caller
    const auditResult = await caller.audit.list({ itemId });

    const revealEntries = auditResult.entries.filter(
      (e: { eventType: string }) => e.eventType === "access.reveal",
    );

    expect(revealEntries.length).toBeGreaterThanOrEqual(2);

    const deniedEntry = revealEntries.find((e: { result: string }) => e.result === "denied");
    const allowedEntry = revealEntries.find((e: { result: string }) => e.result === "allowed");

    expect(deniedEntry).toBeDefined();
    expect(allowedEntry).toBeDefined();
    expect(deniedEntry?.agentId).toBe(agent.agentId);
    expect(allowedEntry?.agentId).toBe(agent.agentId);
  });

  test("audit query filters by eventType", async () => {
    // Setup: user, org, agent with permission on a server item
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const { itemId } = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      fields: { value: "filter-test" },
    });

    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
      name: "filter-bot",
    });

    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });

    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // Generate an access.reveal event
    await agentCaller.access.reveal({ itemId });

    // Query with eventType filter
    const filtered = await caller.audit.list({ eventType: "access.reveal" });

    expect(filtered.entries.length).toBeGreaterThanOrEqual(1);

    for (const entry of filtered.entries) {
      expect(entry.eventType).toBe("access.reveal");
    }
  });

  test("audit query pagination with cursor", async () => {
    // Setup: user, org, agent
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
      name: "pagination-bot",
    });

    // Create 5 items, grant permission on each, generate 5 audit entries
    for (let i = 0; i < 5; i++) {
      const { itemId } = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        label: `pagination-item-${i}`,
        fields: { value: `val-${i}` },
      });

      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId,
        capability: "reveal_plaintext",
        grantedBy: owner.userId,
      });

      const session = await seedAgentSession(db, {
        agentId: agent.agentId,
        userId: owner.userId,
      });

      const agentCaller = createAgentCaller(db, auth, session.rawToken);
      await agentCaller.access.reveal({ itemId });
    }

    // Fetch first page
    const page1 = await caller.audit.list({ limit: 2 });
    expect(page1.entries.length).toBe(2);
    expect(page1.nextCursor).toBeTruthy();

    // Fetch second page using cursor
    const page2 = await caller.audit.list({ limit: 2, cursor: page1.nextCursor as string });
    expect(page2.entries.length).toBeGreaterThanOrEqual(1);

    // Verify no overlap between pages
    const page1Ids = new Set(page1.entries.map((e: { id: number }) => e.id));
    const page2Ids = page2.entries.map((e: { id: number }) => e.id);

    for (const id of page2Ids) {
      expect(page1Ids.has(id)).toBe(false);
    }
  });

  test("filters by agentId, itemId, and result combine with AND", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const itemA = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const itemB = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: itemA.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: owner.userId });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // Generate two allowed reveals (item A) + one denied attempt (item B).
    await agentCaller.access.reveal({ itemId: itemA.itemId });
    await agentCaller.access.reveal({ itemId: itemA.itemId });
    try {
      await agentCaller.access.reveal({ itemId: itemB.itemId });
    } catch {
      /* expected */
    }

    // (agentId, itemId, result) — should return only the allowed itemA rows.
    const onlyAllowedA = await caller.audit.list({
      agentId: agent.agentId,
      itemId: itemA.itemId,
      result: "allowed",
    });
    expect(onlyAllowedA.entries.length).toBeGreaterThanOrEqual(2);
    for (const entry of onlyAllowedA.entries) {
      expect(entry.itemId).toBe(itemA.itemId);
      expect(entry.result).toBe("allowed");
    }

    // (agentId, result=denied) — itemB only.
    const onlyDenied = await caller.audit.list({
      agentId: agent.agentId,
      result: "denied",
    });
    expect(onlyDenied.entries.length).toBeGreaterThanOrEqual(1);
    for (const entry of onlyDenied.entries) {
      expect(entry.result).toBe("denied");
    }
  });

  test("nextCursor is null when fewer entries than the limit are returned", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: owner.userId });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);
    await agentCaller.access.reveal({ itemId: item.itemId });

    // limit=50 against 1 row → nextCursor must be null (no further pages).
    const out = await caller.audit.list({ limit: 50 });
    expect(out.nextCursor).toBeNull();
  });
});
