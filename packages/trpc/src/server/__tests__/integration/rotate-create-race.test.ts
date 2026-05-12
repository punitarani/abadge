import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, createDb, type Database, eq } from "@abadge/db";
import { items, profiles } from "@abadge/db/schema";
import { seedOrg, seedProfile, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// The shared test DB uses `max: 1` (single pooled connection). That means two
// concurrent `ctx.db.transaction(...)` calls on the same Database instance
// would serialize on the pool — hiding the race condition we're trying to
// detect. For the concurrent-rotate + concurrent-create test, we instantiate
// two *independent* Database clients against the same Postgres URL so each
// caller gets its own connection and the two txns can actually overlap.
const DEFAULT_TEST_DB = "postgresql://abadge:abadge@localhost:5432/abadge_test";
// biome-ignore lint/style/noRestrictedGlobals: test helper mirrors getTestDb
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB;

function makeIndependentDb(): Database {
  return createDb(TEST_DATABASE_URL);
}

describe("rotateKey + items.create race (§I5-RACE)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  // Independent DB clients are hoisted here so both the rotate+create and
  // rotate+rotate tests share the same pool and we dispose them once in afterAll,
  // preventing CI connection leaks.
  let dbA: Database;
  let dbB: Database;

  beforeAll(async () => {
    await migrateTestDb();
    dbA = makeIndependentDb();
    dbB = makeIndependentDb();
  });

  afterAll(async () => {
    // Release the independent connections; the shared `db` (getTestDb()) is
    // managed by the test harness and must NOT be ended here.
    await (dbA as unknown as { $client: { end(): Promise<void> } }).$client.end();
    await (dbB as unknown as { $client: { end(): Promise<void> } }).$client.end();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("concurrent rotateKey + items.create: no orphaned item with stale cryptoVersion", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "Race Org", slug: "race-org" });
    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });

    // Bootstrap the profile so rotateKey has something to work with.
    const bootstrapCaller = createOperatorCaller(db, auth, user.headers, org.orgId);
    await bootstrapCaller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "wrap-v1",
      kdfSalt: "salt-v1",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });

    // Seed an existing ZK item so rotate has something to rewrap.
    const existingItemId = crypto.randomUUID();
    await db.insert(items).values({
      id: existingItemId,
      createdBy: user.userId,
      organizationId: org.orgId,
      profileId: profile.profileId,
      label: "existing item",
      storageMode: "zero_knowledge",
      encryptedItemKey: "ek-v1",
      ciphertext: "ct-v1",
      contentNonce: "content-nonce-v1",
      cryptoVersion: 1,
    });

    // Two independent Database clients → two independent connections → real
    // concurrency on distinct Postgres backends. The shared pool's `max: 1`
    // would otherwise force serialization on the single connection.
    const callerA = createOperatorCaller(dbA, auth, user.headers, org.orgId);
    const callerB = createOperatorCaller(dbB, auth, user.headers, org.orgId);

    const rotatePromise = callerA.profiles.rotateKey({
      profileId: profile.profileId,
      wrappedRootKey: "wrap-v2",
      rekeyedItems: [{ itemId: existingItemId, encryptedItemKey: "ek-v2" }],
    });
    const createPromise = callerB.items.create({
      storageMode: "zero_knowledge",
      id: crypto.randomUUID(),
      label: "new item",
      encryptedItemKey: "ek-new",
      ciphertext: "ct-new",
    });

    const [rotateResult, createResult] = await Promise.allSettled([rotatePromise, createPromise]);

    // Advisory lock serializes. Exactly one of these two outcomes holds:
    //
    // Case A — create takes the lock first:
    //   Insert commits at keyVersion=1. Rotate then takes the lock, SELECTs
    //   items (now includes the new one, not in rekeyedItems), coverage check
    //   FAILS with ROTATE_KEY_INCOMPLETE, rotate rolls back.
    //   Expected: create fulfilled, rotate rejected.
    //
    // Case B — rotate takes the lock first:
    //   Rotate commits at keyVersion=2. Create then takes the lock, re-reads
    //   keyVersion=2, inserts new item with cryptoVersion=2 (no CAS provided,
    //   tagged at post-rotate version). Both succeed.
    //
    // Either way, the new item's cryptoVersion must match the profile's
    // keyVersion at the end of the race — no orphaned item wrapped under a
    // retired key.
    //
    // Empirically on this harness the rotate side tends to acquire the lock
    // first (Case B), so the Case A branch may not execute in a given run;
    // both branches are kept so the test stays correct under either timing.

    const [profileRow] = await db
      .select({ keyVersion: profiles.keyVersion })
      .from(profiles)
      .where(eq(profiles.id, profile.profileId));
    const newItemRows = await db
      .select({ cryptoVersion: items.cryptoVersion })
      .from(items)
      .where(and(eq(items.profileId, profile.profileId), eq(items.label, "new item")));

    if (rotateResult.status === "fulfilled" && createResult.status === "fulfilled") {
      // Case B: rotate first, create second. Both succeed.
      expect(profileRow?.keyVersion).toBe(2);
      expect(newItemRows).toHaveLength(1);
      expect(newItemRows[0]?.cryptoVersion).toBe(2);
    } else if (createResult.status === "fulfilled" && rotateResult.status === "rejected") {
      // Case A: create first; rotate rejected because coverage was incomplete.
      const rotErr = (rotateResult as PromiseRejectedResult).reason as {
        code?: string;
        cause?: { code?: string };
      };
      expect(rotErr.cause?.code).toBe("ROTATE_KEY_INCOMPLETE");
      expect(profileRow?.keyVersion).toBe(1);
      expect(newItemRows).toHaveLength(1);
      expect(newItemRows[0]?.cryptoVersion).toBe(1);
    } else {
      throw new Error(
        `Unexpected outcome: rotate=${rotateResult.status} create=${createResult.status}`,
      );
    }
  });

  test("items.create with stale expectedKeyVersion after rotate: aborts with CONFLICT", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "CAS Org", slug: "cas-org" });
    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    await caller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "wrap-v1",
      kdfSalt: "salt-v1",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });

    // Rotate to v=2.
    await caller.profiles.rotateKey({
      profileId: profile.profileId,
      wrappedRootKey: "wrap-v2",
      rekeyedItems: [],
    });

    // Attempt to insert with stale expectedKeyVersion=1 — must be rejected.
    try {
      await caller.items.create({
        storageMode: "zero_knowledge",
        id: crypto.randomUUID(),
        label: "stale wrap",
        encryptedItemKey: "ek-stale",
        ciphertext: "ct-stale",
        expectedKeyVersion: 1,
      });
      expect.unreachable("create with stale expectedKeyVersion should have thrown CONFLICT");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("CONFLICT");
      expect(err.cause?.code).toBe("CONFLICT");
    }

    // Confirm no item was inserted (txn rollback held).
    const rows = await db.select().from(items).where(eq(items.profileId, profile.profileId));
    expect(rows).toHaveLength(0);
  });

  test("items.create without expectedKeyVersion tags cryptoVersion from current profile", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "Compat Org", slug: "compat-org" });
    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    await caller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "wrap-v1",
      kdfSalt: "salt-v1",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });

    const created = await caller.items.create({
      storageMode: "zero_knowledge",
      id: crypto.randomUUID(),
      label: "compat item",
      encryptedItemKey: "ek-compat",
      ciphertext: "ct-compat",
    });

    const [row] = await db.select().from(items).where(eq(items.id, created.id));
    expect(row?.cryptoVersion).toBe(1);
  });

  test("rotateKey with missing new ZK item: aborts with ROTATE_KEY_INCOMPLETE (deterministic Case A)", async () => {
    // Forces Case A deterministically: a ZK item is pre-inserted BEFORE rotateKey
    // is called, and the rotate payload deliberately omits it.
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "CaseA Org", slug: "casea-org" });
    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    await caller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "wrap-v1",
      kdfSalt: "salt-v1",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });

    // Pre-insert a ZK item that the rotate payload will omit.
    const orphanId = crypto.randomUUID();
    await db.insert(items).values({
      id: orphanId,
      createdBy: user.userId,
      organizationId: org.orgId,
      profileId: profile.profileId,
      label: "orphan",
      storageMode: "zero_knowledge",
      encryptedItemKey: "ek-omit",
      ciphertext: "ct-omit",
      cryptoVersion: 1,
    });

    try {
      await caller.profiles.rotateKey({
        profileId: profile.profileId,
        wrappedRootKey: "wrap-v2",
        rekeyedItems: [], // deliberately omits the orphan
      });
      expect.unreachable("rotateKey with missing ZK item should have thrown ROTATE_KEY_INCOMPLETE");
    } catch (err: unknown) {
      const e = err as { code?: string; cause?: { code?: string } };
      expect(e.code).toBe("BAD_REQUEST");
      expect(e.cause?.code).toBe("ROTATE_KEY_INCOMPLETE");
    }

    // Profile did NOT advance; orphan still at cryptoVersion=1.
    const [prof] = await db
      .select({ keyVersion: profiles.keyVersion })
      .from(profiles)
      .where(eq(profiles.id, profile.profileId));
    expect(prof?.keyVersion).toBe(1);
    const [item] = await db
      .select({ cryptoVersion: items.cryptoVersion })
      .from(items)
      .where(eq(items.id, orphanId));
    expect(item?.cryptoVersion).toBe(1);
  });

  test("concurrent rotateKey + rotateKey: both serialized by advisory lock, no wrap clobber", async () => {
    // Two concurrent rotates on the same profile run under pg_advisory_xact_lock.
    // The lock serializes them: each re-reads keyVersion inside the lock, so they
    // cannot both commit at keyVersion=2 (clobber). Both succeed sequentially:
    //   - first  commits at keyVersion=2 with its wrap
    //   - second acquires lock, re-reads keyVersion=2, commits at keyVersion=3
    // After both complete, keyVersion=3 (advanced twice) and the final wrappedRootKey
    // is the second caller's wrap — but critically the first's wrap was NOT silently
    // overwritten at the same keyVersion.
    //
    // Contrast with un-fixed code (nextKeyVersion computed OUTSIDE lock):
    //   - both read keyVersion=1 before acquiring lock, both compute nextKeyVersion=2
    //   - first commits (keyVersion=2, wrap-A). second also commits (keyVersion=2, wrap-B).
    //   - keyVersion stays at 2; wrap-A is silently overwritten.
    //
    // This test catches the regression: without the locked re-read, both callers
    // compute nextKeyVersion=2 and both commit at keyVersion=2. With the fix,
    // they commit at keyVersions 2 and 3.
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "RR Org", slug: "rr-org" });
    const profile = await seedProfile(db, org.orgId, { storageMode: "zero_knowledge" });
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);

    await caller.profiles.bootstrap({
      profileId: profile.profileId,
      wrappedRootKey: "wrap-v1",
      kdfSalt: "salt-v1",
      kdfParams: {
        algorithm: "argon2id",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
        hashLength: 32,
      },
    });

    // Use the two independent DB clients so each rotate runs on its own connection
    // and the two transactions can actually overlap in the Postgres scheduler.
    const callerA = createOperatorCaller(dbA, auth, user.headers, org.orgId);
    const callerB = createOperatorCaller(dbB, auth, user.headers, org.orgId);

    const [resA, resB] = await Promise.allSettled([
      callerA.profiles.rotateKey({
        profileId: profile.profileId,
        wrappedRootKey: "wrap-A",
        rekeyedItems: [],
      }),
      callerB.profiles.rotateKey({
        profileId: profile.profileId,
        wrappedRootKey: "wrap-B",
        rekeyedItems: [],
      }),
    ]);

    // With the lock + locked re-read in place, both rotates succeed (serialized).
    expect(resA.status).toBe("fulfilled");
    expect(resB.status).toBe("fulfilled");

    // With the fix: first caller commits at keyVersion=2, second re-reads and
    // commits at keyVersion=3. Final keyVersion=3 (advanced twice — no clobber).
    // Without the fix: both commit at keyVersion=2 (clobber); keyVersion stays at 2.
    const [row] = await db
      .select({ wrappedRootKey: profiles.wrappedRootKey, keyVersion: profiles.keyVersion })
      .from(profiles)
      .where(eq(profiles.id, profile.profileId));
    expect(row?.keyVersion).toBe(3);
    // The last committed wrap wins, which is one of the two submitted.
    if (!row?.wrappedRootKey) throw new Error("wrappedRootKey should be set after rotate");
    expect(["wrap-A", "wrap-B"]).toContain(row.wrappedRootKey);
  });
});
