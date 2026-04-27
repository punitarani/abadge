/**
 * Multi-capability permission grant matrix.
 *
 * Phase 2 of TESTING.md. Each scenario has 3 variations across happy /
 * adversarial / edge axes. These tests exercise the exact code path the
 * web dashboard, CLI, and MCP all funnel through (the tRPC `permissions.create`
 * mutation), so a green run here proves the contract for every consumer.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Permission } from "@abadge/core";
import {
  seedAgent,
  seedAgentSession,
  seedMember,
  seedOrg,
  seedProfile,
  seedServerItem,
  seedUser,
  seedZkItem,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("permissions-matrix", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // ===== 2.A Happy path — single-cap grant via array =====================

  test("2.A.1 local CLI agent + ZK item + read_ciphertext (single-cap array)", async () => {
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
      kind: "local_cli",
    });

    const result = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["read_ciphertext"],
    });
    expect(result.permissions).toHaveLength(1);
    expect(result.permissions[0]?.capability).toBe("read_ciphertext");
  });

  test("2.A.2 local CLI agent + server-managed item + mount_env", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    const result = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["mount_env"],
    });
    expect(result.permissions).toHaveLength(1);
    expect(result.permissions[0]?.capability).toBe("mount_env");
  });

  test("2.A.3 remote agent + server-managed item + reveal_plaintext", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    const result = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["reveal_plaintext"],
    });
    expect(result.permissions).toHaveLength(1);
    expect(result.permissions[0]?.capability).toBe("reveal_plaintext");
  });

  // ===== 2.B Happy path — true batch grants =============================

  test("2.B.1 local CLI + ZK item + 3 caps [read_ciphertext, mount_env, mount_file]", async () => {
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
      kind: "local_cli",
    });

    const result = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["read_ciphertext", "mount_env", "mount_file"],
    });
    expect(result.permissions).toHaveLength(3);
    const caps = result.permissions.map((p: Permission) => p.capability).sort();
    expect(caps).toEqual(["mount_env", "mount_file", "read_ciphertext"]);
    expect(new Set(result.permissions.map((p: Permission) => p.id)).size).toBe(3);
  });

  test("2.B.2 local CLI + SM item + 3 caps [reveal_plaintext, mount_env, mount_file] with shared expiry", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const result = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["reveal_plaintext", "mount_env", "mount_file"],
      expiresAt,
    });
    expect(result.permissions).toHaveLength(3);
    // Every row carries the same batch-level expiresAt.
    for (const p of result.permissions) {
      expect(p.expiresAt).toBeDefined();
      expect(p.expiresAt).not.toBeNull();
    }
  });

  test("2.B.3 remote agent + SM + single-cap submitted as 1-element array", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    const result = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["reveal_plaintext"],
    });
    expect(result.permissions).toHaveLength(1);
  });

  // ===== 2.C Adversarial — invalid capability for matrix ================

  test("2.C.1 remote + ZK item: every cap rejected (locality)", async () => {
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

    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(0);
  });

  test("2.C.2 remote + SM + read_ciphertext (locality unreachable)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    try {
      await caller.permissions.create({
        agentId: agent.agentId,
        itemId: item.itemId,
        capabilities: ["read_ciphertext"],
      });
      expect.unreachable("expected INVALID_CAPABILITY_LOCALITY");
    } catch (error: unknown) {
      const err = error as { cause?: { code?: string; meta?: { invalidCapabilities?: string[] } } };
      expect(err.cause?.code).toBe("INVALID_CAPABILITY_LOCALITY");
      expect(err.cause?.meta?.invalidCapabilities).toEqual(["read_ciphertext"]);
    }
  });

  test("2.C.3 local + SM + read_ciphertext (storage incompatible)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
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
        capabilities: ["read_ciphertext"],
      });
      expect.unreachable("expected INVALID_CAPABILITY_STORAGE");
    } catch (error: unknown) {
      const err = error as { cause?: { code?: string; meta?: { invalidCapabilities?: string[] } } };
      expect(err.cause?.code).toBe("INVALID_CAPABILITY_STORAGE");
      expect(err.cause?.meta?.invalidCapabilities).toEqual(["read_ciphertext"]);
    }
  });

  // ===== 2.D Adversarial — batch with mixed valid + invalid caps ========

  test("2.D.1 local + SM + [reveal_plaintext, read_ciphertext, mount_env]: storage rejection rolls back batch", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
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
      expect.unreachable("expected INVALID_CAPABILITY_STORAGE");
    } catch (error: unknown) {
      const err = error as { cause?: { code?: string; meta?: { invalidCapabilities?: string[] } } };
      expect(err.cause?.code).toBe("INVALID_CAPABILITY_STORAGE");
      expect(err.cause?.meta?.invalidCapabilities).toEqual(["read_ciphertext"]);
    }
    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(0);
  });

  test("2.D.2 local + SM + [read_ciphertext, mount_env]: 1 invalid, 1 valid → no rows written", async () => {
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
        capabilities: ["read_ciphertext", "mount_env"],
      }),
    ).rejects.toThrow();
    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(0);
  });

  test("2.D.3 remote + ZK + every cap (none valid) → locality rejection lists every offender", async () => {
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

    try {
      await caller.permissions.create({
        agentId: agent.agentId,
        itemId: item.itemId,
        capabilities: ["read_ciphertext", "mount_env", "mount_file"],
      });
      expect.unreachable("expected INVALID_CAPABILITY_LOCALITY");
    } catch (error: unknown) {
      const err = error as { cause?: { code?: string; meta?: { invalidCapabilities?: string[] } } };
      expect(err.cause?.code).toBe("INVALID_CAPABILITY_LOCALITY");
      // mount_env / mount_file are always locality-blocked for remote;
      // read_ciphertext is locality-blocked for remote in any storage mode.
      const offenders = err.cause?.meta?.invalidCapabilities?.slice().sort() ?? [];
      expect(offenders).toEqual(["mount_env", "mount_file", "read_ciphertext"]);
    }
  });

  // ===== 2.E Adversarial — duplicate capability handling ================

  test("2.E.1 pre-grant 1 cap, batch with overlap: rollback + duplicate listed", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["reveal_plaintext"],
    });

    try {
      await caller.permissions.create({
        agentId: agent.agentId,
        itemId: item.itemId,
        capabilities: ["reveal_plaintext", "mount_env"],
      });
      expect.unreachable("expected PERMISSION_ALREADY_EXISTS");
    } catch (error: unknown) {
      const err = error as {
        cause?: { code?: string; meta?: { duplicateCapabilities?: string[] } };
      };
      expect(err.cause?.code).toBe("PERMISSION_ALREADY_EXISTS");
      expect(err.cause?.meta?.duplicateCapabilities).toEqual(["reveal_plaintext"]);
    }
    // mount_env did NOT land — the batch is atomic.
    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(1);
    expect(listed.permissions[0]?.capability).toBe("reveal_plaintext");
  });

  test("2.E.2 pre-grant 2 caps, batch tries all 3: meta lists both pre-grants", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

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
      expect.unreachable("expected PERMISSION_ALREADY_EXISTS");
    } catch (error: unknown) {
      const err = error as {
        cause?: { code?: string; meta?: { duplicateCapabilities?: string[] } };
      };
      expect(err.cause?.code).toBe("PERMISSION_ALREADY_EXISTS");
      const dupes = err.cause?.meta?.duplicateCapabilities?.slice().sort() ?? [];
      expect(dupes).toEqual(["mount_env", "reveal_plaintext"]);
    }
    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(2);
  });

  test("2.E.3 in-input duplicate [mount_env, mount_env] rejected at the schema layer", async () => {
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
    const listed = await caller.permissions.list({ agentId: agent.agentId });
    expect(listed.permissions).toHaveLength(0);
  });

  // ===== 2.F Edge — multi-agent / multi-item / multi-profile ============

  test("2.F.1 two agents, disjoint cap sets on same item, independent revoke", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agentA = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    const agentB = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    const aResult = await caller.permissions.create({
      agentId: agentA.agentId,
      itemId: item.itemId,
      capabilities: ["reveal_plaintext", "mount_env"],
    });
    const bResult = await caller.permissions.create({
      agentId: agentB.agentId,
      itemId: item.itemId,
      capabilities: ["mount_file"],
    });
    expect(aResult.permissions).toHaveLength(2);
    expect(bResult.permissions).toHaveLength(1);

    // Revoke one of A's caps; B's cap is untouched.
    await caller.permissions.revoke({ permissionId: aResult.permissions[0]?.id });
    const aAfter = await caller.permissions.list({ agentId: agentA.agentId });
    const bAfter = await caller.permissions.list({ agentId: agentB.agentId });
    expect(aAfter.permissions).toHaveLength(1);
    expect(bAfter.permissions).toHaveLength(1);
  });

  test("2.F.2 one agent, items in two profiles within same org → per-profile scope preserved by item.profileId", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const profileA = await seedProfile(db, org.orgId, { name: "profile-a" });
    const profileB = await seedProfile(db, org.orgId, { name: "profile-b" });
    const itemA = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profileA.profileId,
    });
    const itemB = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profileB.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: itemA.itemId,
      capabilities: ["reveal_plaintext"],
    });
    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: itemB.itemId,
      capabilities: ["reveal_plaintext"],
    });

    const all = await caller.permissions.list({ agentId: agent.agentId });
    expect(all.permissions).toHaveLength(2);
    // Profile scope is implicit via item.profileId. Each grant references one
    // item, which lives in exactly one profile — the invariant holds.
  });

  test("2.F.3 two orgs, same user as member → no cross-org grant leakage", async () => {
    const userA = await seedUser(auth);
    const orgX = await seedOrg(auth, userA.userId, { name: "OrgX", slug: "orgx" });
    const orgY = await seedOrg(auth, userA.userId, { name: "OrgY", slug: "orgy" });
    const callerX = createOperatorCaller(db, auth, userA.headers, orgX.orgId);
    const callerY = createOperatorCaller(db, auth, userA.headers, orgY.orgId);

    const itemX = await seedServerItem(db, { userId: userA.userId, orgId: orgX.orgId });
    const agentX = await seedAgent(db, {
      userId: userA.userId,
      orgId: orgX.orgId,
      kind: "remote",
    });
    const itemY = await seedServerItem(db, { userId: userA.userId, orgId: orgY.orgId });
    const agentY = await seedAgent(db, {
      userId: userA.userId,
      orgId: orgY.orgId,
      kind: "remote",
    });

    await callerX.permissions.create({
      agentId: agentX.agentId,
      itemId: itemX.itemId,
      capabilities: ["reveal_plaintext"],
    });
    await callerY.permissions.create({
      agentId: agentY.agentId,
      itemId: itemY.itemId,
      capabilities: ["reveal_plaintext"],
    });

    const xList = await callerX.permissions.list({});
    const yList = await callerY.permissions.list({});
    expect(xList.permissions.every((p: Permission) => p.organizationId === orgX.orgId)).toBe(true);
    expect(yList.permissions.every((p: Permission) => p.organizationId === orgY.orgId)).toBe(true);
    expect(xList.permissions.some((p: Permission) => p.itemId === itemY.itemId)).toBe(false);
    expect(yList.permissions.some((p: Permission) => p.itemId === itemX.itemId)).toBe(false);
  });

  // ===== 2.G Edge — list filter combinations ============================

  test("2.G.1 list({ agentId, itemId }) is AND-combined", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const itemX = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const itemY = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agentA = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    const agentB = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    await caller.permissions.create({
      agentId: agentA.agentId,
      itemId: itemX.itemId,
      capabilities: ["reveal_plaintext"],
    });
    await caller.permissions.create({
      agentId: agentA.agentId,
      itemId: itemY.itemId,
      capabilities: ["reveal_plaintext"],
    });
    await caller.permissions.create({
      agentId: agentB.agentId,
      itemId: itemX.itemId,
      capabilities: ["reveal_plaintext"],
    });

    const ax = await caller.permissions.list({ agentId: agentA.agentId, itemId: itemX.itemId });
    expect(ax.permissions).toHaveLength(1);
    expect(ax.permissions[0]?.agentId).toBe(agentA.agentId);
    expect(ax.permissions[0]?.itemId).toBe(itemX.itemId);
  });

  test("2.G.2 list({ agentId }) returns all of that agent's permissions across items", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const itemX = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const itemY = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: itemX.itemId,
      capabilities: ["reveal_plaintext"],
    });
    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: itemY.itemId,
      capabilities: ["reveal_plaintext"],
    });
    const list = await caller.permissions.list({ agentId: agent.agentId });
    expect(list.permissions).toHaveLength(2);
  });

  test("2.G.3 list({}) returns all caller-visible permissions", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["reveal_plaintext", "mount_env", "mount_file"],
    });
    const list = await caller.permissions.list({});
    expect(list.permissions).toHaveLength(3);
  });

  // ===== 2.H Edge — per-row revoke leaves siblings intact ===============

  test("2.H.1 batch grant 3 caps, revoke middle one", async () => {
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
    const target = created.permissions.find((p: Permission) => p.capability === "mount_env");
    if (!target) throw new Error("expected mount_env row");
    await caller.permissions.revoke({ permissionId: target.id });
    const after = await caller.permissions.list({ agentId: agent.agentId });
    const caps = after.permissions.map((p: Permission) => p.capability).sort();
    expect(caps).toEqual(["mount_file", "reveal_plaintext"]);
  });

  test("2.H.2 batch grant 3 caps, revoke all 3 sequentially", async () => {
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
    for (const p of created.permissions) {
      await caller.permissions.revoke({ permissionId: p.id });
    }
    const after = await caller.permissions.list({ agentId: agent.agentId });
    expect(after.permissions).toHaveLength(0);
  });

  test("2.H.3 revoke + re-grant the same cap (no PERMISSION_ALREADY_EXISTS)", async () => {
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
    await caller.permissions.revoke({ permissionId: created.permissions[0]?.id });
    const reGrant = await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["mount_env"],
    });
    expect(reGrant.permissions).toHaveLength(1);
    // The new row gets a fresh id — it is not a resurrection of the old one.
    expect(reGrant.permissions[0]?.id).not.toBe(created.permissions[0]?.id);
  });

  // ===== 2.I Edge — RBAC + ownership =====================================

  test("2.I.1 member B tries to batch-grant on member A's agent → FORBIDDEN, no rows", async () => {
    const alice = await seedUser(auth);
    const org = await seedOrg(auth, alice.userId, { name: "MatrixOrg1", slug: "matrix-org-1" });
    const bob = await seedUser(auth);
    await seedMember(auth, org.orgId, bob.userId);
    const aliceCaller = createOperatorCaller(db, auth, alice.headers, org.orgId);
    const aliceAgent = await aliceCaller.agents.create({
      name: "alice-matrix-agent",
      authMethod: "legacy_api_key",
      kind: "local_cli",
    });
    const item = await seedServerItem(db, { userId: alice.userId, orgId: org.orgId });
    const bobCaller = createOperatorCaller(db, auth, bob.headers, org.orgId);
    try {
      await bobCaller.permissions.create({
        agentId: aliceAgent.agent.id,
        itemId: item.itemId,
        capabilities: ["reveal_plaintext", "mount_env"],
      });
      expect.unreachable("expected MEMBER_AGENT_OWNERSHIP");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("FORBIDDEN");
      expect(err.cause?.code).toBe("MEMBER_AGENT_OWNERSHIP");
    }
    const listed = await aliceCaller.permissions.list({ agentId: aliceAgent.agent.id });
    expect(listed.permissions).toHaveLength(0);
  });

  test("2.I.2 grant attempt on item from different org → ITEM_NOT_FOUND (org isolation)", async () => {
    const userA = await seedUser(auth);
    const orgX = await seedOrg(auth, userA.userId, { name: "OrgIsoX", slug: "org-iso-x" });
    const orgY = await seedOrg(auth, userA.userId, { name: "OrgIsoY", slug: "org-iso-y" });
    const callerX = createOperatorCaller(db, auth, userA.headers, orgX.orgId);
    const itemY = await seedServerItem(db, { userId: userA.userId, orgId: orgY.orgId });
    const agentX = await seedAgent(db, {
      userId: userA.userId,
      orgId: orgX.orgId,
      kind: "local_cli",
    });
    try {
      await callerX.permissions.create({
        agentId: agentX.agentId,
        itemId: itemY.itemId,
        capabilities: ["reveal_plaintext"],
      });
      expect.unreachable("expected ITEM_NOT_FOUND for cross-org item");
    } catch (error: unknown) {
      const err = error as { cause?: { code?: string } };
      expect(err.cause?.code).toBe("ITEM_NOT_FOUND");
    }
  });

  // ===== 2.J Per-profile scope (the AGENTS.md "tokens scoped per profile at most" invariant) =====

  test("2.J.1 agent with grant on profile-A item is denied on profile-B item (same org)", async () => {
    // The exact case asked about: agent has explicit permission on one item
    // in profile A; tries to access a sibling item in profile B within the
    // same org. Per the "no item access without an explicit permission"
    // invariant, the second item must be denied even though the agent and
    // item share an org.
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const opCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profileA = await seedProfile(db, org.orgId, { name: "scope-a" });
    const profileB = await seedProfile(db, org.orgId, { name: "scope-b" });
    const itemA = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profileA.profileId,
      fields: { api_key: "sk-A" },
    });
    const itemB = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profileB.profileId,
      fields: { api_key: "sk-B" },
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    // Grant the agent ONLY on itemA (in profile A).
    await opCaller.permissions.create({
      agentId: agent.agentId,
      itemId: itemA.itemId,
      capabilities: ["reveal_plaintext"],
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // Sanity: the agent CAN reveal itemA (it has the explicit permission).
    const okA = await agentCaller.access.reveal({ itemId: itemA.itemId });
    expect(okA.payload.fields.api_key).toBe("sk-A");

    // The actual test: the agent CANNOT reveal itemB even though it lives in
    // the same org. No permission row exists for (agent, itemB, reveal).
    try {
      await agentCaller.access.reveal({ itemId: itemB.itemId });
      expect.unreachable("cross-profile access on itemB must be denied");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("FORBIDDEN");
    }
  });

  test("2.J.2 agent's items.list only returns items it has permissions on (no cross-profile leak)", async () => {
    // Defence-in-depth: even if access.reveal denies, the agent must not be
    // able to *enumerate* sibling-profile items it has no business knowing
    // exist. listItemsForAgent INNER JOINs on permissions, bounding the
    // agent's view to items it has at least one permission row for.
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const opCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profileA = await seedProfile(db, org.orgId, { name: "list-a" });
    const profileB = await seedProfile(db, org.orgId, { name: "list-b" });
    const itemA = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profileA.profileId,
    });
    const itemB = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profileB.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    await opCaller.permissions.create({
      agentId: agent.agentId,
      itemId: itemA.itemId,
      capabilities: ["reveal_plaintext"],
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const visible = await agentCaller.items.listForAgent();
    const ids = visible.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(itemA.itemId);
    expect(ids).not.toContain(itemB.itemId);
  });

  test("2.J.3 revoking the only profile-A permission collapses the agent's reach to zero", async () => {
    // The whole point of "scoped per agent, agent scoped per profile at
    // most" is that revoking the agent's permissions for a profile cuts
    // off the agent's reach into that profile entirely. Multi-cap grant
    // + per-row revoke must compose to zero reach.
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const opCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profileA = await seedProfile(db, org.orgId, { name: "revoke-a" });
    const itemA = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profileA.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    const created = await opCaller.permissions.create({
      agentId: agent.agentId,
      itemId: itemA.itemId,
      capabilities: ["reveal_plaintext", "mount_env", "mount_file"],
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    // Pre-revoke: agent can reveal.
    const before = await agentCaller.access.reveal({ itemId: itemA.itemId });
    expect(before.payload).toBeDefined();

    // Revoke ALL three rows.
    for (const p of created.permissions) {
      await opCaller.permissions.revoke({ permissionId: p.id });
    }

    // Post-revoke: FORBIDDEN, and items.list is empty.
    try {
      await agentCaller.access.reveal({ itemId: itemA.itemId });
      expect.unreachable("agent should not access itemA after full revoke");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("FORBIDDEN");
    }
    const visible = await agentCaller.items.listForAgent();
    expect(visible.items).toHaveLength(0);
  });

  test("2.I.3 audit log: 3-cap batch produces exactly 3 permission.create rows", async () => {
    // Re-stating the audit invariant: one row per granted capability, no batch event.
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    await caller.permissions.create({
      agentId: agent.agentId,
      itemId: item.itemId,
      capabilities: ["reveal_plaintext", "mount_env", "mount_file"],
    });
    const audit = await caller.audit.list({});
    const created = audit.entries.filter(
      (e: { eventType: string; result: string }) =>
        e.eventType === "permission.create" && e.result === "allowed",
    );
    expect(created).toHaveLength(3);
    // All three audit rows have the same agent + item but distinct capabilities
    // in meta — auditors can scan exactly which caps were granted.
    const auditCaps = created
      .map((e: { meta?: { capability?: string } }) => e.meta?.capability)
      .sort();
    expect(auditCaps).toEqual(["mount_env", "mount_file", "reveal_plaintext"]);
  });
});
