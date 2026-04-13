import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedProfile,
  seedServerItem,
  seedUser,
  seedZkItem,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("access", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("access.reveal returns decrypted payload for authorized agent", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      fields: { api_key: "sk-12345", endpoint: "https://api.example.com" },
    });
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

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.access.reveal({ itemId: item.itemId });
    expect(result.payload.fields.api_key).toBe("sk-12345");
  });

  test("access.reveal with field parameter returns only that field", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    // Use default fields (username, password) so "password" exists
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
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

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.access.reveal({ itemId: item.itemId, field: "password" });
    expect(result.payload.fields.password).toBeDefined();
    expect(Object.keys(result.payload.fields).length).toBe(1);
  });

  test("access.reveal denied without permission", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    try {
      await agentCaller.access.reveal({ itemId: item.itemId });
      expect.unreachable("reveal without permission should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("access.reveal denied with expired permission", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    // Seed an already-expired permission
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    try {
      await agentCaller.access.reveal({ itemId: item.itemId });
      expect.unreachable("reveal with expired permission should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("access.ciphertext for local agent with ZK item", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const item = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "read_ciphertext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.access.ciphertext({ itemId: item.itemId });
    expect(result.ciphertext).toBeTruthy();
    expect(result.encryptedItemKey).toBeTruthy();
  });

  test("access.ciphertext denied for remote agent", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const item = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    // Seed permission directly to bypass capability matrix check
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "read_ciphertext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    try {
      await agentCaller.access.ciphertext({ itemId: item.itemId });
      expect.unreachable("remote agent accessing ciphertext should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("cross-org access is impossible", async () => {
    // Org 1: item lives here
    const owner1 = await seedUser(auth);
    const org1 = await seedOrg(auth, owner1.userId);
    const item = await seedServerItem(db, {
      userId: owner1.userId,
      orgId: org1.orgId,
    });

    // Org 2: agent lives here
    const owner2 = await seedUser(auth);
    const org2 = await seedOrg(auth, owner2.userId);
    const agent = await seedAgent(db, {
      userId: owner2.userId,
      orgId: org2.orgId,
      kind: "remote",
    });

    // Seed a permission record directly pointing across orgs
    await seedPermission(db, {
      orgId: org2.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner2.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner2.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // The access router's loadAccessibleItem checks eq(items.organizationId, agentOrganizationId)
    // so the item from org1 is invisible to the org2 agent
    try {
      await agentCaller.access.reveal({ itemId: item.itemId });
      expect.unreachable("cross-org access should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("NOT_FOUND");
    }
  });
});
