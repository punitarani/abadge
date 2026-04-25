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
import { signEd25519 } from "@abadge/crypto/shared";
import { desc, eq } from "@abadge/db";
import { auditLogs, profiles } from "@abadge/db/schema";
import type { AppBindings } from "../../context";
import { createTrpcCallerFactory } from "../../init";
import { orgHasBootstrappedProfile, userHasUsableOrg } from "../../onboarding-gate";
import { appRouter } from "../../router";
import { seedAgent, seedAgentSession, seedOrg, seedProfile, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { TEST_ENV } from "../helpers/test-env";

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
    // seedProfile doesn't populate wrappedRootKey, matching the
    // "ZK profile row created but never bootstrapped" edge case the
    // onboarding gate must continue to flag as incomplete.
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
    // Create only an incomplete ZK profile (no wrappedRootKey) — covers
    // the edge case of a ZK profile row that exists but never finished
    // its bootstrap (e.g. the dashboard drawer was abandoned mid-flow).
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

  // ---------------------------------------------------------------------------
  // Audit-log invariant
  //
  // Existing AGENTS.md invariant: "Every allowed and denied agent access
  // attempt must be logged in audit_log." The two new agent-side gates
  // (agentProcedure at-use, exchangeAgentSession at-issuance) must write an
  // audit row before throwing ONBOARDING_INCOMPLETE — otherwise denials are
  // silent and the invariant is violated.
  // ---------------------------------------------------------------------------

  test("agentProcedure: ONBOARDING_INCOMPLETE writes audit row with reason=onboarding_incomplete", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    // Incomplete ZK profile: present but not bootstrapped.
    await seedProfile(db, orgId, { storageMode: "zero_knowledge" });

    const agent = await seedAgent(db, {
      userId: user.userId,
      orgId,
      authMethod: "legacy_api_key",
    });
    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: user.userId });

    const agentCaller = createAgentCaller(db, auth, session.rawToken);
    let caught: unknown;
    try {
      await agentCaller.agents.self();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const trpcErr = caught as { code?: string; cause?: { code?: string } };
    expect(trpcErr.code).toBe("FORBIDDEN");
    expect(trpcErr.cause?.code).toBe("ONBOARDING_INCOMPLETE");

    // The audit insert is fire-and-forget (must not invert auth-fail on DB
    // error) — give the I/O a tick to settle before asserting on the row.
    await new Promise((r) => setTimeout(r, 50));

    const [row] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.agentId, agent.agentId))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);
    expect(row).toBeDefined();
    expect(row?.eventType).toBe("agent.session_reject");
    expect(row?.result).toBe("denied");
    expect(row?.organizationId).toBe(orgId);
    expect(row?.userId).toBe(user.userId);
    expect((row?.meta as { reason?: string } | null)?.reason).toBe("onboarding_incomplete");
  });

  test("exchangeAgentSession: ONBOARDING_INCOMPLETE writes audit row with reason=onboarding_incomplete", async () => {
    const user = await seedUser(auth);
    const { orgId } = await seedOrg(auth, user.userId, { withDefaultProfile: false });
    await seedProfile(db, orgId, { storageMode: "zero_knowledge" }); // incomplete

    // Seed an enrolled public-key agent (publicKey set) so we can drive the
    // challenge → exchange flow without going through the full bootstrap path.
    const agent = await seedAgent(db, {
      userId: user.userId,
      orgId,
      authMethod: "public_key_session",
    });
    if (!agent.keyPair) throw new Error("seedAgent returned no keyPair for public_key_session");

    const callerFactory = createTrpcCallerFactory(appRouter);
    const publicCaller = callerFactory({
      req: new Request("http://test"),
      resHeaders: new Headers(),
      env: { ...TEST_ENV } as AppBindings,
      validatedEnv: TEST_ENV,
      db,
      auth,
      ipAddress: "127.0.0.1",
    });

    const challenge = await publicCaller.auth.createChallenge({ agentId: agent.agentId });
    const signature = await signEd25519(agent.keyPair.privateKey, challenge.challenge);

    let caught: unknown;
    try {
      await publicCaller.auth.exchangeSession({
        agentId: agent.agentId,
        challengeId: challenge.challengeId,
        challenge: challenge.challenge,
        signature,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const trpcErr = caught as { code?: string; cause?: { code?: string } };
    expect(trpcErr.code).toBe("FORBIDDEN");
    expect(trpcErr.cause?.code).toBe("ONBOARDING_INCOMPLETE");

    // logBaseAudit is yielded inside the Effect, so the audit row is durable
    // by the time the failure propagates. No setTimeout dance needed here.
    const [row] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.agentId, agent.agentId))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);
    expect(row).toBeDefined();
    expect(row?.eventType).toBe("agent.session_reject");
    expect(row?.result).toBe("denied");
    expect(row?.organizationId).toBe(orgId);
    expect(row?.userId).toBe(user.userId);
    expect((row?.meta as { reason?: string } | null)?.reason).toBe("onboarding_incomplete");
  });
});
