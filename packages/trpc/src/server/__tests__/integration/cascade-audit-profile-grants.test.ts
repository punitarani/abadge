import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "@abadge/db";
import { auditLogs, permissions } from "@abadge/db/schema";
import {
  seedAgent,
  seedOrg,
  seedPermission,
  seedProfile,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("cascade audit for profile-grant revocation", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // profiles.delete cascades audit rows for each profile-target permission
  // -------------------------------------------------------------------------
  test("deleting profile writes permission.revoke_cascade audit per profile-grant", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
    const agent1 = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    const agent2 = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    // Two profile-target grants (different agents, different capabilities).
    const p1Id = crypto.randomUUID();
    const p2Id = crypto.randomUUID();
    await db.insert(permissions).values([
      {
        id: p1Id,
        organizationId: org.orgId,
        agentId: agent1.agentId,
        itemId: null,
        profileId: profile.profileId,
        capability: "read",
        grantedBy: owner.userId,
      },
      {
        id: p2Id,
        organizationId: org.orgId,
        agentId: agent2.agentId,
        itemId: null,
        profileId: profile.profileId,
        capability: "use",
        grantedBy: owner.userId,
      },
    ]);

    // Profile must be empty of items to allow delete (PROFILE_NOT_EMPTY).
    await caller.profiles.delete({ profileId: profile.profileId });

    const cascadeRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.profileId, profile.profileId),
          eq(auditLogs.eventType, "permission.revoke_cascade"),
          eq(auditLogs.result, "cascade"),
        ),
      );
    expect(cascadeRows.length).toBe(2);
    const meta1 = cascadeRows.find(
      (r) => (r.meta as Record<string, unknown>).permissionId === p1Id,
    );
    const meta2 = cascadeRows.find(
      (r) => (r.meta as Record<string, unknown>).permissionId === p2Id,
    );
    expect(meta1).toBeDefined();
    expect(meta2).toBeDefined();
    expect((meta1?.meta as Record<string, unknown>).reason).toBe("profile_deleted");
    expect((meta1?.meta as Record<string, unknown>).capability).toBe("read");
    expect((meta2?.meta as Record<string, unknown>).capability).toBe("use");

    // DB FK cascade removed the rows themselves.
    const remaining = await db
      .select()
      .from(permissions)
      .where(eq(permissions.profileId, profile.profileId));
    expect(remaining.length).toBe(0);
  });

  test("deleting profile with zero profile-grants still allowed (no cascade rows)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });

    await caller.profiles.delete({ profileId: profile.profileId });

    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.profileId, profile.profileId),
          eq(auditLogs.eventType, "permission.revoke_cascade"),
        ),
      );
    expect(rows.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // agents.revoke cascades audit rows for each (item OR profile) permission
  // -------------------------------------------------------------------------
  test("revoking agent writes permission.revoke_cascade per grant (item + profile)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
    });
    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    // One item-target grant + one profile-target grant.
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "read",
      grantedBy: owner.userId,
    });
    const profGrantId = crypto.randomUUID();
    await db.insert(permissions).values({
      id: profGrantId,
      organizationId: org.orgId,
      agentId: agent.agentId,
      itemId: null,
      profileId: profile.profileId,
      capability: "use",
      grantedBy: owner.userId,
    });

    await caller.agents.revoke({ agentId: agent.agentId });

    const cascadeRows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.agentId, agent.agentId),
          eq(auditLogs.eventType, "permission.revoke_cascade"),
          eq(auditLogs.result, "cascade"),
        ),
      );
    expect(cascadeRows.length).toBe(2);

    const itemTargetRow = cascadeRows.find(
      (r) => (r.meta as Record<string, unknown>).target === "item",
    );
    const profileTargetRow = cascadeRows.find(
      (r) => (r.meta as Record<string, unknown>).target === "profile",
    );
    expect(itemTargetRow).toBeDefined();
    expect(profileTargetRow).toBeDefined();
    expect((itemTargetRow?.meta as Record<string, unknown>).reason).toBe("agent_revoked");
    expect((profileTargetRow?.meta as Record<string, unknown>).permissionId).toBe(profGrantId);
  });
});
