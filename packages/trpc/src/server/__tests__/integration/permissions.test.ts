import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  seedAgent,
  seedOrg,
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
});
