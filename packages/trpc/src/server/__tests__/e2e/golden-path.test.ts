import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedAgent, seedAgentSession, seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("e2e golden path", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("full operator-to-agent secret access workflow", async () => {
    // 1. Create a user with a real session
    const owner = await seedUser(auth);

    // 2. Create an org
    const org = await seedOrg(auth, owner.userId);

    // 3. Create an operator caller scoped to the org
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // 4. Create a server-managed item
    const itemResult = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "prod-db-password",
        kind: "opaque",
        tags: ["database", "production"],
        fields: { password: "s3cret!", host: "db.acme.com" },
      },
    });
    expect(itemResult.id).toBeDefined();
    const itemId = itemResult.id;

    // 5. Create an agent via tRPC (legacy_api_key, remote)
    const agentResult = await caller.agents.create({
      name: "deploy-bot",
      kind: "remote",
      authMethod: "legacy_api_key",
    });
    expect(agentResult.agent).toBeDefined();
    expect(agentResult.agent.id).toBeDefined();
    const agentId = agentResult.agent.id;

    // 6. Grant reveal_plaintext permission
    const permResult = await caller.permissions.create({
      agentId,
      itemId,
      capabilities: ["reveal_plaintext"],
    });
    expect(permResult.permissions).toHaveLength(1);
    expect(permResult.permissions[0]).toBeDefined();

    // 7. Create an agent session (inserts a hashed token into agentSessions)
    const session = await seedAgentSession(db, {
      agentId,
      userId: owner.userId,
    });

    // 9. Create an agent caller authenticated with the raw session token
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // 10. Agent reveals the item
    const revealResult = await agentCaller.access.reveal({
      itemId,
      purpose: "deploy",
    });
    expect(revealResult.payload).toBeDefined();
    expect(revealResult.payload.fields.password).toBe("s3cret!");
    expect(revealResult.payload.fields.host).toBe("db.acme.com");

    // 11. Verify audit trail contains an allowed access.reveal event
    const auditResult = await caller.audit.list({
      itemId,
      eventType: "access.reveal",
      result: "allowed",
    });
    expect(auditResult.entries.length).toBeGreaterThanOrEqual(1);

    const revealEntry = auditResult.entries.find(
      (e: { eventType: string; result: string }) =>
        e.eventType === "access.reveal" && e.result === "allowed",
    );
    expect(revealEntry).toBeDefined();
    expect(revealEntry?.agentId).toBe(agentId);
    expect(revealEntry?.itemId).toBe(itemId);
  });

  test("agent without permission is denied", async () => {
    // 1. Create user, org, operator caller
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // 2. Create a server-managed item
    const itemResult = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "staging-api-key",
        kind: "opaque",
        tags: ["staging"],
        fields: { apiKey: "sk_staging_abc123" },
      },
    });
    const itemId = itemResult.id;

    // 3. Create an agent via seedAgent
    //    — no permission granted
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
      name: "unauthorized-bot",
    });

    // 4. Create agent session and agent caller
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // 5. Attempt access.reveal — should throw (no permission)
    try {
      await agentCaller.access.reveal({ itemId });
      expect.unreachable("access.reveal should have thrown for unpermitted agent");
    } catch (error: unknown) {
      // tRPC wraps domain errors — verify we got a FORBIDDEN-class error
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }

    // 6. Verify denial is audited
    const auditResult = await caller.audit.list({
      itemId,
      result: "denied",
    });
    expect(auditResult.entries.length).toBeGreaterThanOrEqual(1);

    const deniedEntry = auditResult.entries.find(
      (e: { eventType: string; result: string }) =>
        e.eventType === "access.reveal" && e.result === "denied",
    );
    expect(deniedEntry).toBeDefined();
    expect(deniedEntry?.agentId).toBe(agent.agentId);
    expect(deniedEntry?.itemId).toBe(itemId);
  });
});
