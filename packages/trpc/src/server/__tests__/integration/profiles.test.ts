import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { items, profiles } from "@abadge/db/schema";
import { seedOrg, seedProfile, seedServerItem, seedUser, seedZkItem } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * Marks a seeded profile as "bootstrapped" so rotateKey passes the
 * `profile.wrappedRootKey != null` precondition.
 */
async function bootstrapProfileRow(
  db: ReturnType<typeof getTestDb>,
  profileId: string,
): Promise<void> {
  await db
    .update(profiles)
    .set({
      wrappedRootKey: "initial-wrapped-root-key",
      kdfSalt: "initial-salt",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    })
    .where(eq(profiles.id, profileId));
}

describe("profiles.rotateKey", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("rotates every ZK item's encryptedItemKey and bumps cryptoVersion", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    await bootstrapProfileRow(db, profile.profileId);

    const zk1 = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "zk-one",
    });
    const zk2 = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "zk-two",
    });

    const result = await caller.profiles.rotateKey({
      profileId: profile.profileId,
      wrappedRootKey: "new-wrapped-root-key",
      rekeyedItems: [
        {
          itemId: zk1.itemId,
          encryptedItemKey: "new-eik-1",
        },
        {
          itemId: zk2.itemId,
          encryptedItemKey: "new-eik-2",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.keyVersion).toBe(2);

    const [row1] = await db.select().from(items).where(eq(items.id, zk1.itemId)).limit(1);
    expect(row1?.encryptedItemKey).toBe("new-eik-1");
    expect(row1?.cryptoVersion).toBe(2);

    const [row2] = await db.select().from(items).where(eq(items.id, zk2.itemId)).limit(1);
    expect(row2?.encryptedItemKey).toBe("new-eik-2");
    expect(row2?.cryptoVersion).toBe(2);

    const [profileRow] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profile.profileId))
      .limit(1);
    expect(profileRow?.wrappedRootKey).toBe("new-wrapped-root-key");
    expect(profileRow?.keyVersion).toBe(2);
  });

  test("rejects partial rekey with ROTATE_KEY_INCOMPLETE and lists missing itemIds", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    await bootstrapProfileRow(db, profile.profileId);

    const zk1 = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "zk-one",
    });
    const zk2 = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "zk-two-omitted",
    });

    // Capture initial ZK-item state so we can prove the transaction rolled back
    // cleanly (no partial UPDATE landed before the coverage check threw).
    const [zk1Initial] = await db.select().from(items).where(eq(items.id, zk1.itemId)).limit(1);
    const [zk2Initial] = await db.select().from(items).where(eq(items.id, zk2.itemId)).limit(1);

    try {
      await caller.profiles.rotateKey({
        profileId: profile.profileId,
        wrappedRootKey: "new-wrapped-root-key",
        rekeyedItems: [
          {
            itemId: zk1.itemId,
            encryptedItemKey: "new-eik-1",
          },
        ],
      });
      expect.unreachable("partial rekey should have thrown");
    } catch (error: unknown) {
      const trpcError = error as {
        code?: string;
        cause?: { code?: string; meta?: { missingItemIds?: string[] } };
      };
      expect(trpcError.code).toBe("BAD_REQUEST");
      expect(trpcError.cause?.code).toBe("ROTATE_KEY_INCOMPLETE");
      expect(trpcError.cause?.meta?.missingItemIds).toEqual([zk2.itemId]);
    }

    // And the DB must be untouched (no partial commit).
    const [profileRow] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profile.profileId))
      .limit(1);
    expect(profileRow?.wrappedRootKey).toBe("initial-wrapped-root-key");
    expect(profileRow?.keyVersion).toBe(1);

    // Re-read the items rows and confirm their crypto material is unchanged.
    // Guards against a future regression where the item UPDATE loop executes
    // before (or independently of) the coverage-check throw.
    const [zk1After] = await db.select().from(items).where(eq(items.id, zk1.itemId)).limit(1);
    const [zk2After] = await db.select().from(items).where(eq(items.id, zk2.itemId)).limit(1);
    expect(zk1After?.encryptedItemKey).toBe(zk1Initial?.encryptedItemKey ?? null);
    expect(zk1After?.cryptoVersion).toBe(zk1Initial?.cryptoVersion ?? 1);
    expect(zk2After?.encryptedItemKey).toBe(zk2Initial?.encryptedItemKey ?? null);
    expect(zk2After?.cryptoVersion).toBe(zk2Initial?.cryptoVersion ?? 1);
  });

  test("accepts empty rekeyedItems when profile has no ZK items", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    await bootstrapProfileRow(db, profile.profileId);

    const result = await caller.profiles.rotateKey({
      profileId: profile.profileId,
      wrappedRootKey: "new-wrapped-root-key",
      rekeyedItems: [],
    });

    expect(result.ok).toBe(true);
    expect(result.keyVersion).toBe(2);
  });

  test("soft-deleted ZK items are not counted in the coverage check", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    await bootstrapProfileRow(db, profile.profileId);

    const live = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "zk-live",
    });
    const deleted = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "zk-deleted",
    });
    await db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, deleted.itemId));

    const result = await caller.profiles.rotateKey({
      profileId: profile.profileId,
      wrappedRootKey: "new-wrapped-root-key",
      rekeyedItems: [
        {
          itemId: live.itemId,
          encryptedItemKey: "new-eik-live",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.keyVersion).toBe(2);

    const [liveRow] = await db.select().from(items).where(eq(items.id, live.itemId)).limit(1);
    expect(liveRow?.encryptedItemKey).toBe("new-eik-live");
  });

  test("server_managed items in the profile are ignored by the coverage check", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    await bootstrapProfileRow(db, profile.profileId);

    const zk = await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "zk-only",
    });
    // server_managed item in the same profile — must not block rotate
    await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "server-only",
    });

    const result = await caller.profiles.rotateKey({
      profileId: profile.profileId,
      wrappedRootKey: "new-wrapped-root-key",
      rekeyedItems: [
        {
          itemId: zk.itemId,
          encryptedItemKey: "new-eik",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.keyVersion).toBe(2);
  });
});
