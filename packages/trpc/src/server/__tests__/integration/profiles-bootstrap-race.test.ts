import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { profiles } from "@abadge/db/schema";
import { seedOrg, seedProfile, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("profiles.bootstrap atomic race (W2T7-003)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("concurrent bootstraps: exactly one succeeds, the other gets PROFILE_ALREADY_EXISTS", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "Race Org", slug: "race-org" });
    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    const bootstrapA = caller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "wrapped-key-A",
      kdfSalt: "salt-A",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });
    const bootstrapB = caller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "wrapped-key-B",
      kdfSalt: "salt-B",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });

    const results = await Promise.allSettled([bootstrapA, bootstrapB]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // Confirm the error is PROFILE_ALREADY_EXISTS, not something unrelated.
    // tRPC wraps domain errors: err.code is the tRPC-level code, err.cause.code
    // is the domain error code surfaced by our ConflictError.
    const err = (rejected[0] as PromiseRejectedResult).reason as {
      code?: string;
      cause?: { code?: string };
    };
    expect(err.code).toBe("CONFLICT");
    expect(err.cause?.code).toBe("PROFILE_ALREADY_EXISTS");

    // Read the persisted row back — exactly one of the two wrapped keys is present.
    const [row] = await db
      .select({ wrappedRootKey: profiles.wrappedRootKey, kdfSalt: profiles.kdfSalt })
      .from(profiles)
      .where(eq(profiles.id, profile.profileId));
    if (!row) throw new Error("profile row not found after bootstrap");
    if (!row.wrappedRootKey) throw new Error("wrappedRootKey should be set after bootstrap");
    expect(["wrapped-key-A", "wrapped-key-B"]).toContain(row.wrappedRootKey);
    expect(row.kdfSalt).toBe(row.wrappedRootKey === "wrapped-key-A" ? "salt-A" : "salt-B");
  });

  test("sequential: first bootstrap succeeds, second gets PROFILE_ALREADY_EXISTS", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "Seq Org", slug: "seq-org" });
    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    const kdfParams = {
      algorithm: "argon2id" as const,
      memory: 65536,
      iterations: 3,
      parallelism: 1,
      hashLength: 32,
    };

    const first = await caller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "first-key",
      kdfSalt: "first-salt",
      kdfParams,
    });
    expect(first.ok).toBe(true);

    try {
      await caller.profiles.bootstrap({
        profileId: profile.profileId,
        wrappedRootKey: "second-key",
        kdfSalt: "second-salt",
        kdfParams,
      });
      expect.unreachable("second bootstrap should have thrown PROFILE_ALREADY_EXISTS");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("CONFLICT");
      expect(err.cause?.code).toBe("PROFILE_ALREADY_EXISTS");
    }
  });

  test("unowned profile: NOT_FOUND (no existence leak) not PROFILE_ALREADY_EXISTS", async () => {
    // User A creates a ZK profile; User B (member of a different org) tries to bootstrap it.
    // loadProfileForWrite uses scopedDb.findFirst which filters by org first — a cross-org
    // profileId is indistinguishable from a non-existent one (PROFILE_NOT_FOUND), preventing
    // cross-org existence oracle attacks. The key invariant is still enforced: User B's key
    // is never written, and the error surfaces before the atomic UPDATE runs.
    const userA = await seedUser(auth);
    const orgA = await seedOrg(auth, userA.userId, { name: "Org A", slug: "org-a" });
    const profileA = await seedProfile(db, orgA.orgId, { storageMode: "zero_knowledge" });

    const userB = await seedUser(auth);
    const orgB = await seedOrg(auth, userB.userId, { name: "Org B", slug: "org-b" });
    const callerB = createOperatorCaller(db, auth, userB.headers, orgB.orgId);

    try {
      await callerB.profiles.bootstrap({
        profileId: profileA.profileId,
        wrappedRootKey: "B-key",
        kdfSalt: "B-salt",
        kdfParams: {
          algorithm: "argon2id",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
          hashLength: 32,
        },
      });
      expect.unreachable("cross-org bootstrap should have thrown NOT_FOUND");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      // NOT_FOUND (not PROFILE_ALREADY_EXISTS and not FORBIDDEN) — org-scoped lookup means
      // a cross-org profileId is indistinguishable from a non-existent one, closing the
      // existence oracle. Ownership is still enforced before any write.
      expect(err.code).toBe("NOT_FOUND");
      expect(err.cause?.code).toBe("PROFILE_NOT_FOUND");
    }

    // Confirm User B's key was NOT written to the profile (ownership gate held).
    const [row] = await db
      .select({ wrappedRootKey: profiles.wrappedRootKey })
      .from(profiles)
      .where(eq(profiles.id, profileA.profileId));
    expect(row?.wrappedRootKey).toBeNull();
  });
});
