import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("agents CRUD", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("create legacy API key agent returns one-time key", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const result = await caller.agents.create({
      name: "legacy-bot",
      kind: "remote",
      authMethod: "legacy_api_key",
    });

    expect(result.agent.id).toBeTruthy();
    expect(result.apiKey).toBeTruthy();

    const agentId = result.agent.id;
    const fetched = await caller.agents.get({ agentId });
    expect(fetched.agent.id).toBe(agentId);
    expect(fetched.agent.name).toBe("legacy-bot");
  });

  test("create public_key_session agent with bootstrap token", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const result = await caller.agents.create({
      name: "pk-bot",
      kind: "remote",
      authMethod: "public_key_session",
      issueBootstrapToken: true,
    });

    expect(result.bootstrapToken).toBeTruthy();
    expect(result.bootstrapToken?.startsWith("abe_")).toBe(true);
  });

  test("list agents returns all agents in org", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    await caller.agents.create({
      name: "bot-one",
      kind: "remote",
      authMethod: "legacy_api_key",
    });

    await caller.agents.create({
      name: "bot-two",
      kind: "remote",
      authMethod: "legacy_api_key",
    });

    const result = await caller.agents.list({});
    expect(result.agents).toHaveLength(2);
  });

  test("rotate legacy API key agent issues new key", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.agents.create({
      name: "rotate-bot",
      kind: "remote",
      authMethod: "legacy_api_key",
    });

    const originalKey = created.apiKey;
    const agentId = created.agent.id;

    const rotated = await caller.agents.rotate({ agentId });

    expect(rotated.apiKey).toBeTruthy();
    expect(rotated.apiKey).not.toBe(originalKey);
  });

  test("revoke agent disables it", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.agents.create({
      name: "revoke-bot",
      kind: "remote",
      authMethod: "legacy_api_key",
    });

    const agentId = created.agent.id;

    await caller.agents.revoke({ agentId });

    const fetched = await caller.agents.get({ agentId });
    expect(fetched.agent.enabled).toBe(false);
    expect(fetched.agent.revokedAt).toBeTruthy();
  });
});
