/**
 * Onboarding-complete access gate.
 *
 * Verifies that a user or agent in an organization with no bootstrapped
 * profile cannot use scoped/agent tRPC procedures. "Bootstrapped" means
 * storageMode='server_managed' OR wrappedRootKey IS NOT NULL.
 *
 * Three enforcement points:
 *   1. `scopedSessionProcedure` (init.ts) — user at-use
 *   2. `agentProcedure` (init.ts) — agent at-use
 *   3. `exchangeAgentSession` (auth.ts) — agent at-issuance
 *
 * Mirrors the predicate used by the web onboarding-triage in
 * apps/web/src/app/onboarding/onboarding-triage.ts.
 */

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { profiles } from "@abadge/db/schema";
import { orgHasBootstrappedProfile, userHasUsableOrg } from "../../onboarding-gate";
import { seedOrg, seedProfile, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("onboarding gate (assertOrgOnboardingComplete + userHasUsableOrg)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // ---------------------------------------------------------------------------
  // Predicates
  // ---------------------------------------------------------------------------

  test("orgHasBootstrappedProfile: false when org has no profiles", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    expect(await orgHasBootstrappedProfile(db, orgId)).toBe(false);
  });

  test("orgHasBootstrappedProfile: true for a server_managed profile", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    await seedProfile(db, orgId, { storageMode: "server_managed" });
    expect(await orgHasBootstrappedProfile(db, orgId)).toBe(true);
  });

  test("orgHasBootstrappedProfile: false for a ZK profile without wrappedRootKey", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    await seedProfile(db, orgId, { storageMode: "zero_knowledge" });
    // seedProfile doesn't populate wrappedRootKey, matching the "step 1
    // created, step 2 never ran" scenario onboarding-triage flags as incomplete.
    expect(await orgHasBootstrappedProfile(db, orgId)).toBe(false);
  });

  test("orgHasBootstrappedProfile: true once a ZK profile's wrappedRootKey is set", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    const { profileId } = await seedProfile(db, orgId, {
      storageMode: "zero_knowledge",
    });
    await db
      .update(profiles)
      .set({
        wrappedRootKey: "fake-wrapped-root-key",
        kdfSalt: "fake-salt",
        kdfParams: {
          algorithm: "argon2id",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
          hashLength: 32,
        },
      })
      .where(eq(profiles.id, profileId));
    expect(await orgHasBootstrappedProfile(db, orgId)).toBe(true);
  });

  test("userHasUsableOrg: false for a user with no memberships", async () => {
    const user = await seedUser(auth);
    expect(await userHasUsableOrg(db, user.userId)).toBe(false);
  });

  test("userHasUsableOrg: false when all orgs are incomplete", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    await seedProfile(db, orgId, { storageMode: "zero_knowledge" }); // incomplete
    expect(await userHasUsableOrg(db, user.userId)).toBe(false);
  });

  test("userHasUsableOrg: true once any org is bootstrapped", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    await seedProfile(db, orgId, { storageMode: "server_managed" });
    expect(await userHasUsableOrg(db, user.userId)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // scopedSessionProcedure (user at-use)
  // ---------------------------------------------------------------------------

  test("scoped call: ONBOARDING_INCOMPLETE when user's org has no bootstrapped profile", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    // Create only an incomplete ZK profile (no wrappedRootKey) — mirrors
    // the post-step1/pre-step2 state in the web onboarding flow.
    await seedProfile(db, orgId, { storageMode: "zero_knowledge" });

    const caller = createOperatorCaller(db, auth, user.headers, orgId);
    let caught: unknown;
    try {
      await caller.items.list();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    // The HTTP-level TRPCError carries `code: "FORBIDDEN"` (mapped from the
    // 403 status); the domain code lives on `.cause.code`, matching the
    // pattern used by the other integration tests (see organizations.test.ts
    // around the SLUG_TAKEN assertions).
    const err = caught as { code?: string; cause?: { code?: string }; message?: string };
    expect(err.code).toBe("FORBIDDEN");
    expect(err.cause?.code).toBe("ONBOARDING_INCOMPLETE");
    expect(err.message).toContain("onboarding");
  });

  test("scoped call: succeeds once a server_managed profile exists", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    await seedProfile(db, orgId, { storageMode: "server_managed" });
    const caller = createOperatorCaller(db, auth, user.headers, orgId);
    const result = await caller.items.list();
    expect(result.items).toBeArray();
  });

  // ---------------------------------------------------------------------------
  // onboarding.status endpoint
  // ---------------------------------------------------------------------------

  test("onboarding.status: complete=false for fresh user", async () => {
    const user = await seedUser(auth);
    const caller = createOperatorCaller(db, auth, user.headers);
    const result = await caller.onboarding.status();
    expect(result).toEqual({ complete: false });
  });

  test("onboarding.status: complete=true after bootstrap", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    await seedProfile(db, orgId, { storageMode: "server_managed" });
    const caller = createOperatorCaller(db, auth, user.headers, orgId);
    const result = await caller.onboarding.status();
    expect(result).toEqual({ complete: true });
  });
});
