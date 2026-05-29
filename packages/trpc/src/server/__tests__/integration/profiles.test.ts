import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { items, profiles } from "@abadge/db/schema";
import {
  seedMember,
  seedOrg,
  seedProfile,
  seedServerItem,
  seedUser,
  seedZkItem,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

const KDF_PARAMS = {
  algorithm: "argon2id" as const,
  memory: 65536,
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};

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

// ---------------------------------------------------------------------------
// profiles.create / .list / .get / .delete — CRUD coverage
// ---------------------------------------------------------------------------

describe("profiles CRUD", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("create — happy path returns the new profile and writes audit", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const result = await caller.profiles.create({
      orgId: org.orgId,
      name: "fresh-profile",
      storageMode: "server_managed",
    });
    expect(result.profile.name).toBe("fresh-profile");
    expect(result.profile.organizationId).toBe(org.orgId);
    expect(result.profile.storageMode).toBe("server_managed");
  });

  test("create — duplicate name in same org rejects with PROFILE_ALREADY_EXISTS", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    await caller.profiles.create({
      orgId: org.orgId,
      name: "dup-profile",
      storageMode: "server_managed",
    });

    try {
      await caller.profiles.create({
        orgId: org.orgId,
        name: "dup-profile",
        storageMode: "server_managed",
      });
      expect.unreachable("duplicate profile name should reject");
    } catch (error: unknown) {
      const trpcError = error as { code?: string; cause?: { code?: string } };
      // Domain error surfaces as `cause.code = PROFILE_ALREADY_EXISTS`
      expect(trpcError.cause?.code).toBe("PROFILE_ALREADY_EXISTS");
    }
  });

  test("create — non-admin (member role) is forbidden", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const member = await seedUser(auth);
    await seedMember(auth, org.orgId, member.userId, "member");

    const memberCaller = createOperatorCaller(db, auth, member.headers, org.orgId);
    try {
      await memberCaller.profiles.create({
        orgId: org.orgId,
        name: "mem-tries",
        storageMode: "server_managed",
      });
      expect.unreachable("member should not be able to create a profile");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("list — returns every profile in the org for a member", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    await seedProfile(db, org.orgId, { name: "profile-a" });
    await seedProfile(db, org.orgId, { name: "profile-b" });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const result = await caller.profiles.list({ orgId: org.orgId });
    const names = result.profiles.map((p: { name: string }) => p.name).sort();
    expect(names).toContain("profile-a");
    expect(names).toContain("profile-b");
  });

  test("list — non-member of org is forbidden", async () => {
    const ownerA = await seedUser(auth);
    const orgA = await seedOrg(auth, ownerA.userId);

    // Independent user with their own org; they have no membership in orgA.
    const outsider = await seedUser(auth);
    const orgB = await seedOrg(auth, outsider.userId);

    const outsiderCaller = createOperatorCaller(db, auth, outsider.headers, orgB.orgId);
    try {
      await outsiderCaller.profiles.list({ orgId: orgA.orgId });
      expect.unreachable("non-member should not be able to list profiles in another org");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("get — happy path returns serialized profile for a member", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, { name: "viewable" });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const out = await caller.profiles.get({ profileId: profile.profileId });
    expect(out.profile.id).toBe(profile.profileId);
    expect(out.profile.name).toBe("viewable");
  });

  test("get — unknown profileId rejects with PROFILE_NOT_FOUND", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    try {
      await caller.profiles.get({ profileId: "00000000-0000-0000-0000-000000000000" });
      expect.unreachable("missing profile should reject");
    } catch (error: unknown) {
      const trpcError = error as { code?: string; cause?: { code?: string } };
      expect(trpcError.cause?.code).toBe("PROFILE_NOT_FOUND");
    }
  });

  test("delete — happy path removes a profile with no items", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, { name: "ephemeral" });
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const result = await caller.profiles.delete({ profileId: profile.profileId });
    expect(result.ok).toBe(true);

    const rows = await db.select().from(profiles).where(eq(profiles.id, profile.profileId));
    expect(rows).toHaveLength(0);
  });

  test("delete — profile with active items rejects with PROFILE_NOT_EMPTY", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, {
      name: "still-has-stuff",
      storageMode: "zero_knowledge",
    });
    await seedZkItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      profileId: profile.profileId,
      label: "anchor",
    });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    try {
      await caller.profiles.delete({ profileId: profile.profileId });
      expect.unreachable("non-empty profile should not delete");
    } catch (error: unknown) {
      const trpcError = error as { code?: string; cause?: { code?: string } };
      expect(trpcError.cause?.code).toBe("PROFILE_NOT_EMPTY");
    }

    // Profile must still exist after the rejection.
    const rows = await db.select().from(profiles).where(eq(profiles.id, profile.profileId));
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// profiles.create — personal-account single-profile cap
// ---------------------------------------------------------------------------

describe("profiles.create — personal account cap", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("personal account rejects a second profile with PROFILE_LIMIT_EXCEEDED", async () => {
    const user = await seedUser(auth);
    // A fresh user has no org — createPersonal seeds the personal org + the one
    // default server_managed profile (no org header needed for this call).
    const personal = await createOperatorCaller(
      db,
      auth,
      user.headers,
    ).organizations.createPersonal();
    const caller = createOperatorCaller(db, auth, user.headers, personal.organization.id);

    try {
      await caller.profiles.create({
        orgId: personal.organization.id,
        name: "second-profile",
        storageMode: "server_managed",
      });
      expect.unreachable("personal account should not create a second profile");
    } catch (error: unknown) {
      const trpcError = error as { code?: string; cause?: { code?: string } };
      expect(trpcError.code).toBe("CONFLICT");
      expect(trpcError.cause?.code).toBe("PROFILE_LIMIT_EXCEEDED");
    }

    // Still exactly the one seeded default profile — nothing was written.
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, personal.organization.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(personal.defaultProfile.id);
  });

  test("team org is uncapped — multiple profiles allowed", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId); // seeds one default profile
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    await caller.profiles.create({
      orgId: org.orgId,
      name: "team-one",
      storageMode: "server_managed",
    });
    await caller.profiles.create({
      orgId: org.orgId,
      name: "team-two",
      storageMode: "server_managed",
    });

    // 1 seeded default + 2 created.
    const rows = await db.select().from(profiles).where(eq(profiles.organizationId, org.orgId));
    expect(rows).toHaveLength(3);
  });

  test("personal account can recreate after deleting its only profile (cap is ≤ 1, not a hard block)", async () => {
    const user = await seedUser(auth);
    const personal = await createOperatorCaller(
      db,
      auth,
      user.headers,
    ).organizations.createPersonal();
    const caller = createOperatorCaller(db, auth, user.headers, personal.organization.id);

    // Deleting the seeded default frees the single slot...
    const del = await caller.profiles.delete({ profileId: personal.defaultProfile.id });
    expect(del.ok).toBe(true);

    // ...so exactly one create is allowed again (the supported recovery path).
    const recreated = await caller.profiles.create({
      orgId: personal.organization.id,
      name: "replacement",
      storageMode: "server_managed",
    });
    expect(recreated.profile.name).toBe("replacement");

    // But a second profile is still rejected.
    try {
      await caller.profiles.create({
        orgId: personal.organization.id,
        name: "third",
        storageMode: "server_managed",
      });
      expect.unreachable("personal account should still cap at one profile after recreation");
    } catch (error: unknown) {
      const trpcError = error as { cause?: { code?: string } };
      expect(trpcError.cause?.code).toBe("PROFILE_LIMIT_EXCEEDED");
    }
  });

  test("concurrent creates after deleting the default: advisory lock allows exactly one", async () => {
    const user = await seedUser(auth);
    const personal = await createOperatorCaller(
      db,
      auth,
      user.headers,
    ).organizations.createPersonal();
    const caller = createOperatorCaller(db, auth, user.headers, personal.organization.id);

    // Free the single slot, then race two creates. The per-org advisory lock in
    // assertPersonalProfileCap must serialize them so only one lands — without
    // it both would pass the existence check and leave two profiles (TOCTOU).
    await caller.profiles.delete({ profileId: personal.defaultProfile.id });

    const results = await Promise.allSettled([
      caller.profiles.create({
        orgId: personal.organization.id,
        name: "race-a",
        storageMode: "server_managed",
      }),
      caller.profiles.create({
        orgId: personal.organization.id,
        name: "race-b",
        storageMode: "server_managed",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const err = (rejected[0] as PromiseRejectedResult).reason as {
      code?: string;
      cause?: { code?: string };
    };
    expect(err.cause?.code).toBe("PROFILE_LIMIT_EXCEEDED");

    // Exactly one profile persisted — the race did not slip a second past the check.
    const rows = await db
      .select()
      .from(profiles)
      .where(eq(profiles.organizationId, personal.organization.id));
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// profiles.bootstrap — first-time wrappedRootKey set
// ---------------------------------------------------------------------------

describe("profiles.bootstrap", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("happy path — populates wrappedRootKey + kdfSalt + kdfParams and audits allowed", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, {
      name: "to-bootstrap",
      storageMode: "zero_knowledge",
    });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const result = await caller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "fresh-wrapped-root-key",
      kdfSalt: "fresh-salt",
      kdfParams: KDF_PARAMS,
    });
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(profiles).where(eq(profiles.id, profile.profileId));
    expect(row?.wrappedRootKey).toBe("fresh-wrapped-root-key");
    expect(row?.kdfSalt).toBe("fresh-salt");
  });

  test("double-bootstrap rejects with PROFILE_ALREADY_EXISTS", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, {
      name: "twice",
      storageMode: "zero_knowledge",
      bootstrapped: true,
    });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    try {
      await caller.profiles.bootstrap({
        profileId: profile.profileId,
        wrappedRootKey: "different-wrapped",
        kdfSalt: "different-salt",
        kdfParams: KDF_PARAMS,
      });
      expect.unreachable("second bootstrap should reject");
    } catch (error: unknown) {
      const trpcError = error as { code?: string; cause?: { code?: string } };
      expect(trpcError.cause?.code).toBe("PROFILE_ALREADY_EXISTS");
    }
  });

  test("non-admin caller cannot bootstrap (forbidden via loadProfileForWrite)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, {
      name: "guarded",
      storageMode: "zero_knowledge",
    });

    const memberUser = await seedUser(auth);
    await seedMember(auth, org.orgId, memberUser.userId, "member");
    const memberCaller = createOperatorCaller(db, auth, memberUser.headers, org.orgId);

    try {
      await memberCaller.profiles.bootstrap({
        profileId: profile.profileId,
        wrappedRootKey: "x",
        kdfSalt: "x",
        kdfParams: KDF_PARAMS,
      });
      expect.unreachable("member-role should not be able to bootstrap");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });
});

// ---------------------------------------------------------------------------
// profiles.changePassword — re-wrap after old password proven
// ---------------------------------------------------------------------------

describe("profiles.changePassword", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("happy path — overwrites wrappedRootKey + kdfSalt + kdfParams", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, {
      name: "to-rotate-pw",
      storageMode: "zero_knowledge",
      bootstrapped: true,
    });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const result = await caller.profiles.changePassword({
      profileId: profile.profileId,
      wrappedRootKey: "rotated-wrapped",
      kdfSalt: "rotated-salt",
      kdfParams: KDF_PARAMS,
    });
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(profiles).where(eq(profiles.id, profile.profileId));
    expect(row?.wrappedRootKey).toBe("rotated-wrapped");
    expect(row?.kdfSalt).toBe("rotated-salt");
  });

  test("on a profile that was never bootstrapped, rejects with PROFILE_NOT_FOUND", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, {
      name: "no-pw-yet",
      storageMode: "zero_knowledge",
    });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    try {
      await caller.profiles.changePassword({
        profileId: profile.profileId,
        wrappedRootKey: "x",
        kdfSalt: "x",
        kdfParams: KDF_PARAMS,
      });
      expect.unreachable("changePassword on un-bootstrapped profile should reject");
    } catch (error: unknown) {
      const trpcError = error as { cause?: { code?: string } };
      expect(trpcError.cause?.code).toBe("PROFILE_NOT_FOUND");
    }
  });
});

// ---------------------------------------------------------------------------
// profiles.setupRecovery — set the recoveryWrappedRootKey column
// ---------------------------------------------------------------------------

describe("profiles.setupRecovery", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("happy path — populates recoveryWrappedRootKey", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, {
      name: "with-recovery",
      storageMode: "zero_knowledge",
      bootstrapped: true,
    });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const result = await caller.profiles.setupRecovery({
      profileId: profile.profileId,
      recoveryWrappedRootKey: "recovery-blob",
    });
    expect(result.ok).toBe(true);

    const [row] = await db.select().from(profiles).where(eq(profiles.id, profile.profileId));
    expect(row?.recoveryWrappedRootKey).toBe("recovery-blob");
  });

  test("rejects with PROFILE_NOT_FOUND on un-bootstrapped profile", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const profile = await seedProfile(db, org.orgId, {
      name: "naked",
      storageMode: "zero_knowledge",
    });

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    try {
      await caller.profiles.setupRecovery({
        profileId: profile.profileId,
        recoveryWrappedRootKey: "anything",
      });
      expect.unreachable("recovery setup on un-bootstrapped profile should reject");
    } catch (error: unknown) {
      const trpcError = error as { cause?: { code?: string } };
      expect(trpcError.cause?.code).toBe("PROFILE_NOT_FOUND");
    }
  });
});
