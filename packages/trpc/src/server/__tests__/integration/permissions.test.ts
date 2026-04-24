import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  seedAgent,
  seedMember,
  seedOrg,
  seedPermission,
  seedProfile,
  seedServerItem,
  seedUser,
  seedZkItem,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("permissions", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("create and list permissions", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    const created = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
    });

    expect(created.permission.agentId).toBe(agent.agentId);
    expect(created.permission.itemId).toBe(item.itemId);
    expect(created.permission.capability).toBe("reveal_plaintext");

    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions.length).toBe(1);
    expect(listed.permissions[0]?.id).toBe(created.permission.id);
  });

  test("revoke permission removes it", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    const created = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
    });

    await caller.permissions.revoke({ permissionId: created.permission.id });

    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions.length).toBe(0);
  });

  test("capability matrix: remote agent cannot get read_ciphertext", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

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

    await expect(
      caller.permissions.create({
        agentId: agent.agentId,
        itemId: item.itemId,
        capability: "read_ciphertext",
      }),
    ).rejects.toThrow();
  });

  test("capability matrix: local agent can get mount_env on server_managed item", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    const created = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "mount_env",
    });

    expect(created.permission.capability).toBe("mount_env");
  });

  test("permission with expiry", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const created = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      expiresAt: futureDate.toISOString(),
    });

    expect(created.permission.expiresAt).toBeDefined();
    expect(new Date(created.permission.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
  });

  // Regression tests for W1S9-001 / fix: Effect.tryPromise → tryAsync on
  // requireOrgRole + requireAgentOwnership. Before the fix, these calls wrapped
  // the thrown ForbiddenError in UnknownException, causing toTrpcError to fall
  // back to INTERNAL_SERVER_ERROR (500) instead of FORBIDDEN (403).
  test("member cannot grant permission on another member's agent (MEMBER_AGENT_OWNERSHIP, not 500)", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "PermOrg1", slug: "perm-org-1" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);

    // Alice owns the agent
    const aliceCaller = createOperatorCaller(db, auth, alice.headers, org.orgId);
    const aliceAgent = await aliceCaller.agents.create({
      name: "alice-agent-perm",
      authMethod: "legacy_api_key",
      kind: "remote",
    });

    const item = await seedServerItem(db, { userId: alice.userId, orgId: org.orgId });

    // Bob tries to grant a permission on alice's agent — must get FORBIDDEN, not 500
    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);
    try {
      await bobCaller.permissions.create({
        agentId: aliceAgent.agent.id,
        itemId: item.itemId,
        capability: "reveal_plaintext",
      });
      expect.unreachable("should have thrown MEMBER_AGENT_OWNERSHIP on create permission");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("FORBIDDEN");
      expect(err.cause?.code).toBe("MEMBER_AGENT_OWNERSHIP");
    }
  });

  test("member cannot revoke permission on another member's agent (FORBIDDEN, not 500)", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "PermOrg2", slug: "perm-org-2" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);

    // Alice owns the agent; seed an item and a permission on it
    const aliceAgent = await seedAgent(db, {
      userId: alice.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    const item = await seedServerItem(db, { userId: alice.userId, orgId: org.orgId });
    const perm = await seedPermission(db, {
      orgId: org.orgId,
      agentId: aliceAgent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: alice.userId,
    });

    // Bob tries to revoke alice's permission — must get FORBIDDEN, not 500
    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);
    try {
      await bobCaller.permissions.revoke({ permissionId: perm.permissionId });
      expect.unreachable("should have thrown MEMBER_AGENT_OWNERSHIP on revoke permission");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("FORBIDDEN");
      expect(err.cause?.code).toBe("MEMBER_AGENT_OWNERSHIP");
    }
  });
});
