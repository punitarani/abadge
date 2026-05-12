import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { auditLogs, permissions } from "@abadge/db/schema";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedProfile,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("permissions.create (profile target)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("profile-target grant authorizes access.read on items in that profile", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      fields: { value: "profile-grant-success" },
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    const created = await caller.permissions.create({
      agentId: agent.agentId,
      profileId: profile.profileId,
      capabilities: ["read"],
    });

    expect(created.permissions).toHaveLength(1);
    expect(created.permissions[0]?.agentId).toBe(agent.agentId);
    expect(created.permissions[0]?.capability).toBe("read");

    // Verify by calling access.read against an item in the profile (no item-level grant)
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.access.read({ itemId: item.itemId });
    if (result.storageMode !== "server_managed") throw new Error("expected SM");
    expect(result.payload.fields.value).toBe("profile-grant-success");
  });

  test("batch with 2 capabilities is atomic — duplicate in middle of batch persists nothing", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    // Pre-seed one row that will collide.
    await db.insert(permissions).values({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      agentId: agent.agentId,
      itemId: null,
      profileId: profile.profileId,
      capability: "use",
      grantedBy: owner.userId,
    });

    // Now request a batch (read + use) — the "use" capability collides.
    try {
      await caller.permissions.create({
        agentId: agent.agentId,
        profileId: profile.profileId,
        capabilities: ["read", "use"],
      });
      throw new Error("should have thrown CONFLICT");
    } catch (e) {
      const trpc = e as { code?: string };
      expect(trpc.code).toBe("CONFLICT");
    }

    // Only the originally-seeded "use" row exists — the "read" row was NOT
    // persisted (transactional all-or-nothing).
    const rows = await db
      .select()
      .from(permissions)
      .where(
        and(eq(permissions.profileId, profile.profileId), eq(permissions.agentId, agent.agentId)),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]?.capability).toBe("use");
  });

  test("profile-target permission.create writes audit row with meta.target='profile'", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    await caller.permissions.create({
      agentId: agent.agentId,
      profileId: profile.profileId,
      capabilities: ["read"],
    });

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.profileId, profile.profileId),
          eq(auditLogs.eventType, "permission.create"),
          eq(auditLogs.result, "allowed"),
        ),
      );
    expect(rows.length).toBe(1);
    const meta = rows[0]?.meta as Record<string, unknown>;
    expect(meta.target).toBe("profile");
    expect(meta.capability).toBe("read");
  });

  test("profile-target with missing profile returns PROFILE_NOT_FOUND", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    try {
      await caller.permissions.create({
        agentId: agent.agentId,
        profileId: crypto.randomUUID(),
        capabilities: ["read"],
      });
      throw new Error("should have thrown NOT_FOUND");
    } catch (e) {
      const trpc = e as { code?: string };
      expect(trpc.code).toBe("NOT_FOUND");
    }
  });
});
