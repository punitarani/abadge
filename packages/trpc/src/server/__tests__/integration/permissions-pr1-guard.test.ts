import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedAgent, seedOrg, seedProfile, seedServerItem, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// §RM-PR1 — Pin the two structural guards in `permissions.create`:
//   1. profile-target inputs are rejected until PR2 wires the unified
//      access pipeline (router lines guarded by `if ("profileId" in input)`).
//   2. canonical capabilities ("read", "use") are rejected until PR2 wires
//      them through the matrix; without this guard, callers got the
//      misleading INVALID_CAPABILITY_LOCALITY error.
// Both errors envelope as BAD_REQUEST so the SDK error class fires the
// correct branch. PR2 lifts both guards atomically; these tests pin the
// current behavior so regressions are loud.

type TrpcErrorShape = { code?: string; cause?: { code?: string; message?: string } };

describe("permissions.create PR1 router guard", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("rejects profile-target inputs with BAD_REQUEST until PR2 wiring lands", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });
    const profile = await seedProfile(db, org.orgId);

    try {
      await caller.permissions.create({
        agentId: agent.agentId,
        profileId: profile.profileId,
        capabilities: ["mount_env"],
      });
      expect.unreachable("permissions.create with profileId should have thrown BAD_REQUEST");
    } catch (error: unknown) {
      const err = error as TrpcErrorShape;
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.cause?.code).toBe("BAD_REQUEST");
      expect(err.cause?.message).toMatch(/profile-target/i);
    }
  });

  test("rejects canonical capabilities with BAD_REQUEST referencing PR2", async () => {
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
        capabilities: ["read"],
      });
      expect.unreachable(
        "permissions.create with canonical capability 'read' should have thrown BAD_REQUEST",
      );
    } catch (error: unknown) {
      const err = error as TrpcErrorShape;
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.cause?.code).toBe("BAD_REQUEST");
      // Hint/message must clearly point at PR 2 so the failure mode is actionable.
      expect(err.cause?.message).toMatch(/not yet routed|PR 2/i);
    }
  });
});
