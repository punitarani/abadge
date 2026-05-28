import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Permission } from "@abadge/core";
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
      capabilities: ["reveal_plaintext"],
    });

    expect(created.permissions).toHaveLength(1);
    expect(created.permissions[0]?.agentId).toBe(agent.agentId);
    expect(created.permissions[0]?.itemId).toBe(item.itemId);
    expect(created.permissions[0]?.capability).toBe("reveal_plaintext");

    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions.length).toBe(1);
    expect(listed.permissions[0]?.id).toBe(created.permissions[0]?.id);
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
      capabilities: ["reveal_plaintext"],
    });

    const id = created.permissions[0]?.id;
    if (!id) throw new Error("expected permission id");
    await caller.permissions.revoke({ permissionId: id });

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
        capabilities: ["read_ciphertext"],
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
      capabilities: ["mount_env"],
    });

    expect(created.permissions[0]?.capability).toBe("mount_env");
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
      capabilities: ["reveal_plaintext"],
      expiresAt: futureDate.toISOString(),
    });

    const expiresAt = created.permissions[0]?.expiresAt;
    expect(expiresAt).toBeDefined();
    expect(new Date(expiresAt as string).getTime()).toBeGreaterThan(Date.now());
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
      issueBootstrapToken: true,
      kind: "remote",
    });

    const item = await seedServerItem(db, { userId: alice.userId, orgId: org.orgId });

    // Bob tries to grant a permission on alice's agent — must get FORBIDDEN, not 500
    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);
    try {
      await bobCaller.permissions.create({
        agentId: aliceAgent.agent.id,
        itemId: item.itemId,
        capabilities: ["reveal_plaintext"],
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

  // ---- Multi-capability batch grants ---------------------------------------

  test("batch grant: 3 capabilities land in one transaction", async () => {
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
      capabilities: ["reveal_plaintext", "mount_env", "mount_file"],
    });

    expect(created.permissions).toHaveLength(3);
    const caps = created.permissions.map((p: Permission) => p.capability).sort();
    expect(caps).toEqual(["mount_env", "mount_file", "reveal_plaintext"]);
    // Each row gets its own id, even though they share (agent, item, expiry, grantedBy)
    expect(new Set(created.permissions.map((p: Permission) => p.id)).size).toBe(3);

    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(3);
  });

  test("batch grant: invalid capability rolls back the entire batch", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // server_managed item — read_ciphertext is invalid for it
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    try {
      await caller.permissions.create({
        agentId: agent.agentId,
        itemId: item.itemId,
        capabilities: ["reveal_plaintext", "read_ciphertext", "mount_env"],
      });
      expect.unreachable("should have thrown INVALID_CAPABILITY_STORAGE");
    } catch (error: unknown) {
      const err = error as { cause?: { code?: string; meta?: { invalidCapabilities?: string[] } } };
      expect(err.cause?.code).toBe("INVALID_CAPABILITY_STORAGE");
      expect(err.cause?.meta?.invalidCapabilities).toEqual(["read_ciphertext"]);
    }

    // Nothing landed: the two valid caps must NOT have been written.
    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(0);
  });

  test("batch grant: duplicate capability rolls back and lists every duplicate", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    // Pre-grant two of the three caps we'll try to batch
    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["reveal_plaintext", "mount_env"],
    });

    try {
      await caller.permissions.create({
        agentId: agent.agentId,
        itemId: item.itemId,
        capabilities: ["reveal_plaintext", "mount_env", "mount_file"],
      });
      expect.unreachable("should have thrown PERMISSION_ALREADY_EXISTS");
    } catch (error: unknown) {
      const err = error as {
        cause?: { code?: string; meta?: { duplicateCapabilities?: string[] } };
      };
      expect(err.cause?.code).toBe("PERMISSION_ALREADY_EXISTS");
      const dupes = err.cause?.meta?.duplicateCapabilities?.slice().sort() ?? [];
      expect(dupes).toEqual(["mount_env", "reveal_plaintext"]);
    }

    // The third capability (mount_file) must NOT have landed: rollback
    // means the original two grants are the only rows.
    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(2);
  });

  test("batch grant: duplicate cap inside the input array is rejected at the schema layer", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    await expect(
      caller.permissions.create({
        agentId: agent.agentId,
        itemId: item.itemId,
        capabilities: ["mount_env", "mount_env"],
      }),
    ).rejects.toThrow();

    // Schema rejection means nothing reached the router; no rows written.
    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(0);
  });

  test("batch grant: per-capability revoke leaves siblings intact", async () => {
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
      capabilities: ["reveal_plaintext", "mount_env", "mount_file"],
    });

    const target = created.permissions.find((p: Permission) => p.capability === "mount_file");
    if (!target) throw new Error("expected mount_file row");
    await caller.permissions.revoke({ permissionId: target.id });

    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(2);
    const remaining = listed.permissions.map((p: Permission) => p.capability).sort();
    expect(remaining).toEqual(["mount_env", "reveal_plaintext"]);
  });

  test("permissions.list filters by (agent, item) pair when both provided", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const item1 = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const item2 = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item1.itemId,
      capabilities: ["reveal_plaintext"],
    });
    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item2.itemId,
      capabilities: ["reveal_plaintext"],
    });

    // Single-filter (agent only) returns both rows
    const byAgent = await caller.permissions.list({ agentId: agent.agentId });
    expect(byAgent.permissions).toHaveLength(2);

    // AND-combined filter returns only the row matching both
    const byPair = await caller.permissions.list({
      agentId: agent.agentId,
      itemId: item1.itemId,
    });
    expect(byPair.permissions).toHaveLength(1);
    expect(byPair.permissions[0]?.itemId).toBe(item1.itemId);
  });
});
