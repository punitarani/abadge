import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedMember, seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("agents ownership (W1S9-001)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("member bob cannot rotate alice's agent", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "Org", slug: "org" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);

    const aliceCaller = createOperatorCaller(db, auth, alice.headers, org.orgId);
    const created = await aliceCaller.agents.create({
      name: "alice-agent",
      authMethod: "legacy_api_key",
      kind: "remote",
    });

    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);

    try {
      await bobCaller.agents.rotate({ agentId: created.agent.id });
      expect.unreachable("should have thrown MEMBER_AGENT_OWNERSHIP on rotate");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("FORBIDDEN");
      expect(err.cause?.code).toBe("MEMBER_AGENT_OWNERSHIP");
    }

    try {
      await bobCaller.agents.revoke({ agentId: created.agent.id });
      expect.unreachable("should have thrown MEMBER_AGENT_OWNERSHIP on revoke");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("FORBIDDEN");
      expect(err.cause?.code).toBe("MEMBER_AGENT_OWNERSHIP");
    }
  });

  test("member can rotate/revoke their own agent", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "Org2", slug: "org2" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);

    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);
    const bobAgent = await bobCaller.agents.create({
      name: "bob-agent",
      authMethod: "legacy_api_key",
      kind: "remote",
    });

    const rotated = await bobCaller.agents.rotate({ agentId: bobAgent.agent.id });
    expect(rotated.apiKey).toBeTruthy();

    const revoked = await bobCaller.agents.revoke({ agentId: bobAgent.agent.id });
    expect(revoked.ok).toBe(true);
  });

  test("owner can rotate/revoke any agent in the org", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "Org3", slug: "org3" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);

    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);
    const bobAgent = await bobCaller.agents.create({
      name: "bob-agent-owner-managed",
      authMethod: "legacy_api_key",
      kind: "remote",
    });

    // Owner (alice) rotates bob's agent — should succeed.
    const aliceCaller = createOperatorCaller(db, auth, alice.headers, org.orgId);
    const rotated = await aliceCaller.agents.rotate({ agentId: bobAgent.agent.id });
    expect(rotated.apiKey).toBeTruthy();
  });
});
