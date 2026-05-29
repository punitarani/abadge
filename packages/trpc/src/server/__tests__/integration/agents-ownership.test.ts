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

  test("member bob cannot revoke alice's agent", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "Org", slug: "org" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);

    const aliceCaller = createOperatorCaller(db, auth, alice.headers, org.orgId);
    const created = await aliceCaller.agents.create({
      name: "alice-agent",
      issueBootstrapToken: true,
      kind: "remote",
    });

    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);

    try {
      await bobCaller.agents.revoke({ agentId: created.agent.id });
      expect.unreachable("should have thrown MEMBER_AGENT_OWNERSHIP on revoke");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("FORBIDDEN");
      expect(err.cause?.code).toBe("MEMBER_AGENT_OWNERSHIP");
    }
  });

  test("member can revoke their own agent", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "Org2", slug: "org2" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);

    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);
    const bobAgent = await bobCaller.agents.create({
      name: "bob-agent",
      issueBootstrapToken: true,
      kind: "remote",
    });

    const revoked = await bobCaller.agents.revoke({ agentId: bobAgent.agent.id });
    expect(revoked.ok).toBe(true);
  });

  test("owner can revoke any agent in the org", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "Org3", slug: "org3" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);

    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);
    const bobAgent = await bobCaller.agents.create({
      name: "bob-agent-owner-managed",
      issueBootstrapToken: true,
      kind: "remote",
    });

    // Owner (alice) revokes bob's agent — should succeed.
    const aliceCaller = createOperatorCaller(db, auth, alice.headers, org.orgId);
    const revoked = await aliceCaller.agents.revoke({ agentId: bobAgent.agent.id });
    expect(revoked.ok).toBe(true);
  });
});
