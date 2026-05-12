import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { auditLogs, mountReservations, permissions } from "@abadge/db/schema";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedProfile,
  seedServerItem,
  seedUser,
  seedZkItem,
} from "../../__tests__/helpers/seed";
import { createTestAuth } from "../../__tests__/helpers/test-auth";
import { createAgentCaller } from "../../__tests__/helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../../__tests__/helpers/test-db";

describe("access pipeline (unified read/use)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // SM read — plaintext payload via canonical capability
  // -------------------------------------------------------------------------
  test("SM read returns plaintext payload", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      fields: { value: "secret-1" },
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
      capability: "read",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    const result = await caller.access.read({ itemId: item.itemId });
    if (result.storageMode !== "server_managed") throw new Error("expected SM");
    expect(result.payload.fields.value).toBe("secret-1");
  });

  // -------------------------------------------------------------------------
  // SM read — legacy capability `reveal_plaintext` still authorizes `read`
  // -------------------------------------------------------------------------
  test("legacy reveal_plaintext grant satisfies canonical read", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      fields: { value: "legacy-grant" },
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
    const caller = createAgentCaller(db, auth, session.rawToken);

    const result = await caller.access.read({ itemId: item.itemId });
    if (result.storageMode !== "server_managed") throw new Error("expected SM");
    expect(result.payload.fields.value).toBe("legacy-grant");
  });

  // -------------------------------------------------------------------------
  // ZK read — envelope for client decrypt
  // -------------------------------------------------------------------------
  test("ZK read returns envelope with cryptoVersion + binding fields", async () => {
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
      capability: "read",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    const result = await caller.access.read({ itemId: item.itemId });
    if (result.storageMode !== "zero_knowledge") throw new Error("expected ZK");
    expect(result.encryptedItemKey.length).toBeGreaterThan(0);
    expect(result.ciphertext.length).toBeGreaterThan(0);
    expect(result.profileId).toBe(profile.profileId);
    expect(result.itemId).toBe(item.itemId);
    expect(result.cryptoVersion).toBeGreaterThanOrEqual(1);
    expect(result.contentVersion).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // SM use — mountId returned with mnt_ prefix
  // -------------------------------------------------------------------------
  test("SM use returns mountId with mnt_ prefix", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "use",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    const result = await caller.access.use({ itemId: item.itemId, delivery: "env" });
    expect(result.mountId.startsWith("mnt_")).toBe(true);
    expect(result.delivery).toBe("env");

    const [reservation] = await db
      .select()
      .from(mountReservations)
      .where(eq(mountReservations.mountId, result.mountId));
    expect(reservation).toBeDefined();
    expect(reservation?.itemId).toBe(item.itemId);
  });

  // -------------------------------------------------------------------------
  // ZK use (local) — mountId returned
  // -------------------------------------------------------------------------
  test("ZK use returns mountId for local agent", async () => {
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
      capability: "use",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    const result = await caller.access.use({ itemId: item.itemId, delivery: "file" });
    expect(result.mountId.startsWith("mnt_")).toBe(true);
    expect(result.delivery).toBe("file");
  });

  // -------------------------------------------------------------------------
  // Profile-level grant satisfies item-level access
  // -------------------------------------------------------------------------
  test("profile-level grant satisfies access.read on items in that profile", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      fields: { value: "profile-grant-secret" },
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    // Profile-target grant (NO item-level row).
    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      agentId: agent.agentId,
      itemId: null,
      profileId: profile.profileId,
      capability: "read",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    const result = await caller.access.read({ itemId: item.itemId });
    if (result.storageMode !== "server_managed") throw new Error("expected SM");
    expect(result.payload.fields.value).toBe("profile-grant-secret");

    // Audit row carries meta.viaProfileGrant = true
    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.itemId, item.itemId), eq(auditLogs.result, "allowed")));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const lastAllowed = rows[rows.length - 1];
    expect((lastAllowed?.meta as Record<string, unknown>)?.viaProfileGrant).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Denied access writes audit row
  // -------------------------------------------------------------------------
  test("denied access writes denied audit row", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const item = await seedServerItem(db, { userId: owner.userId, orgId: org.orgId });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    try {
      await caller.access.read({ itemId: item.itemId });
      throw new Error("should have thrown");
    } catch (e) {
      const trpc = e as { code?: string };
      expect(trpc.code).toBe("FORBIDDEN");
    }

    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.itemId, item.itemId), eq(auditLogs.result, "denied")));
    expect(rows.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Remote + ZK is denied at the constraint gate (audit-before-decrypt)
  // -------------------------------------------------------------------------
  test("remote agent + ZK item denied at constraint check", async () => {
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
    // Grant exists so the failure is unambiguously the constraint, not the perm.
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "read",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    try {
      await caller.access.read({ itemId: item.itemId });
      throw new Error("should have thrown");
    } catch (e) {
      const trpc = e as { code?: string };
      expect(trpc.code).toBe("FORBIDDEN");
    }

    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.itemId, item.itemId), eq(auditLogs.result, "denied")));
    expect(rows.length).toBe(1);
    expect((rows[0]?.meta as Record<string, unknown>)?.reason).toBe("INVALID_CAPABILITY");
  });

  // -------------------------------------------------------------------------
  // Bulk profile use — all-or-nothing (phantom-audit invariant)
  // -------------------------------------------------------------------------
  test("useProfile: 3 items all granted → 3 mountIds + 3 allowed audit rows", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
    const i1 = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const i2 = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const i3 = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    // Single profile-target grant covers all three.
    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      agentId: agent.agentId,
      itemId: null,
      profileId: profile.profileId,
      capability: "use",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    const result = await caller.access.useProfile({
      profileId: profile.profileId,
      delivery: "env",
    });
    expect(result.items.length).toBe(3);
    for (const item of result.items) {
      expect(item.mountId.startsWith("mnt_")).toBe(true);
    }
    const ids = result.items.map((it: { itemId: string }) => it.itemId).sort();
    expect(ids).toEqual([i1.itemId, i2.itemId, i3.itemId].sort());

    const rows = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.profileId, profile.profileId), eq(auditLogs.result, "allowed")));
    expect(rows.length).toBe(3);
  });

  test("useProfile: 3 items, 1 grant missing → throws + 0 'allowed' audit rows", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
    const i1 = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const i2 = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const i3 = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    // Item-level grants for only TWO of the three items.
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: i1.itemId,
      capability: "use",
      grantedBy: owner.userId,
    });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: i2.itemId,
      capability: "use",
      grantedBy: owner.userId,
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const caller = createAgentCaller(db, auth, session.rawToken);

    try {
      await caller.access.useProfile({ profileId: profile.profileId, delivery: "env" });
      throw new Error("should have thrown");
    } catch (e) {
      const trpc = e as { code?: string };
      expect(trpc.code).toBe("FORBIDDEN");
    }

    // Phantom-audit invariant: zero 'allowed' rows for this profile.
    const allowed = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.profileId, profile.profileId), eq(auditLogs.result, "allowed")));
    expect(allowed.length).toBe(0);

    // No mount reservations should be persisted.
    const reservations = await db
      .select()
      .from(mountReservations)
      .where(eq(mountReservations.agentId, agent.agentId));
    expect(reservations.length).toBe(0);

    // Sanity: i3 (the un-granted one) saw a 'denied' row.
    const denied = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.itemId, i3.itemId), eq(auditLogs.result, "denied")));
    expect(denied.length).toBe(1);
  });
});
