import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedAgent, seedOrg, seedServerItem, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// Pins the intentional asymmetry between item-target and profile-target grants
// for canonical capabilities ("read", "use"):
//   - Profile-target accepts canonical caps (see permissions-profile-target.test.ts).
//   - Item-target rejects canonical caps because CAPABILITY_MATRIX is keyed by
//     (locality, storageMode) and carries only the legacy four. Per-item locality
//     x storage matching has no canonical analogue, so item-target grants stay
//     legacy-only by design.
// Removing the explicit BAD_REQUEST below would still fail the call, but with a
// misleading INVALID_CAPABILITY_LOCALITY message. This test pins the coherent
// error so the failure mode keeps naming the workaround.

type TrpcErrorShape = { code?: string; cause?: { code?: string; message?: string } };

describe("permissions.create — item-target canonical cap rejection", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("rejects canonical capability on item-target with actionable BAD_REQUEST", async () => {
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
        "permissions.create with item-target + canonical capability 'read' should have thrown BAD_REQUEST",
      );
    } catch (error: unknown) {
      const err = error as TrpcErrorShape;
      expect(err.code).toBe("BAD_REQUEST");
      expect(err.cause?.code).toBe("BAD_REQUEST");
      // Message must point the caller at the profile-target workaround.
      expect(err.cause?.message).toMatch(/canonical capability|target a profile/i);
    }
  });
});
