import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { generateEd25519KeyPair, signEd25519 } from "@abadge/crypto/shared";
import type { Database } from "@abadge/db";
import { eq } from "@abadge/db";
import { agentEnrollmentTokens, agents, principals } from "@abadge/db/schema";
import type { AppBindings } from "../../context";
import { createTrpcCallerFactory } from "../../init";
import { appRouter } from "../../router";
import { seedOrg, seedUser } from "../helpers/seed";
import type { TestAuth } from "../helpers/test-auth";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { TEST_ENV } from "../helpers/test-env";

// ---------------------------------------------------------------------------
// Public (unauthenticated) caller for enrollment / challenge / exchange
// ---------------------------------------------------------------------------

const callerFactory = createTrpcCallerFactory(appRouter);

function createPublicCaller(db: Database, auth: TestAuth) {
  return callerFactory({
    req: new Request("http://test"),
    resHeaders: new Headers(),
    env: { ...TEST_ENV } as AppBindings,
    validatedEnv: TEST_ENV,
    db,
    auth,
    ipAddress: "127.0.0.1",
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert an unenrolled public_key_session agent into both tables (no publicKey). */
async function insertUnenrolledAgent(
  db: Database,
  opts: { userId: string; orgId: string; name?: string },
): Promise<string> {
  const agentId = crypto.randomUUID();
  const name = opts.name ?? "lifecycle-bot";

  await db.insert(principals).values({
    id: agentId,
    userId: opts.userId,
    kind: "remote",
    locality: "remote",
    authMethod: "public_key_session",
    name,
  });

  await db.insert(agents).values({
    id: agentId,
    organizationId: opts.orgId,
    createdBy: opts.userId,
    kind: "remote",
    locality: "remote",
    authMethod: "public_key_session",
    name,
  });

  return agentId;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent lifecycle", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("full flow: bootstrap -> enroll -> challenge -> exchange -> access", async () => {
    // Setup: user, org, operator caller
    const owner = await seedUser(auth);
    const org = await seedOrg(db, auth, owner.userId);
    const operatorCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const publicCaller = createPublicCaller(db, auth);

    // 1. Create an unenrolled agent and issue a bootstrap token
    const agentId = await insertUnenrolledAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      name: "lifecycle-bot",
    });

    const bt = await operatorCaller.auth.issueBootstrapToken({ agentId });
    expect(bt.bootstrapToken.startsWith("abe_")).toBe(true);
    expect(bt.agentId).toBe(agentId);

    // 2. Generate Ed25519 key pair and enroll
    const keyPair = await generateEd25519KeyPair();
    const enrollResult = await publicCaller.auth.enroll({
      bootstrapToken: bt.bootstrapToken,
      publicKey: keyPair.publicKey,
    });
    expect(enrollResult.agent.id).toBe(agentId);
    expect(enrollResult.enrolledAt).toBeDefined();

    // 3. Request a challenge
    const challengeResult = await publicCaller.auth.createChallenge({ agentId });
    expect(challengeResult.challenge.startsWith("abc_")).toBe(true);
    expect(challengeResult.challengeId).toBeDefined();

    // 4. Sign challenge and exchange for session
    const signature = await signEd25519(keyPair.privateKey, challengeResult.challenge);
    const sessionResult = await publicCaller.auth.exchangeSession({
      agentId,
      challengeId: challengeResult.challengeId,
      challenge: challengeResult.challenge,
      signature,
    });
    expect(sessionResult.session.token.startsWith("abs_")).toBe(true);

    // 5. Use session token to call agents.self()
    const agentCaller = createAgentCaller(db, auth, sessionResult.session.token);
    const selfResult = await agentCaller.agents.self();
    expect(selfResult.agent.id).toBe(agentId);
    expect(selfResult.agent.name).toBe("lifecycle-bot");
  });

  test("expired bootstrap token is rejected", async () => {
    // Setup
    const owner = await seedUser(auth);
    const org = await seedOrg(db, auth, owner.userId);
    const operatorCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const publicCaller = createPublicCaller(db, auth);

    // Create agent and issue bootstrap token
    const agentId = await insertUnenrolledAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const bt = await operatorCaller.auth.issueBootstrapToken({ agentId });

    // Manually expire the token
    await db
      .update(agentEnrollmentTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(agentEnrollmentTokens.agentId, agentId));

    // Attempt enrollment with expired token
    const keyPair = await generateEd25519KeyPair();
    try {
      await publicCaller.auth.enroll({
        bootstrapToken: bt.bootstrapToken,
        publicKey: keyPair.publicKey,
      });
      expect.unreachable("enroll should have thrown for expired bootstrap token");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("already-enrolled agent rejects second enrollment", async () => {
    // Setup
    const owner = await seedUser(auth);
    const org = await seedOrg(db, auth, owner.userId);
    const operatorCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const publicCaller = createPublicCaller(db, auth);

    // Create agent and issue TWO bootstrap tokens BEFORE enrolling.
    // issueBootstrapToken checks agent.publicKey — it rejects if already enrolled.
    const agentId = await insertUnenrolledAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const bt1 = await operatorCaller.auth.issueBootstrapToken({ agentId });
    const bt2 = await operatorCaller.auth.issueBootstrapToken({ agentId });

    // Enroll with the first token
    const keyPair1 = await generateEd25519KeyPair();
    await publicCaller.auth.enroll({
      bootstrapToken: bt1.bootstrapToken,
      publicKey: keyPair1.publicKey,
    });

    // Attempt second enrollment with second token — agent now has a public key
    const keyPair2 = await generateEd25519KeyPair();
    try {
      await publicCaller.auth.enroll({
        bootstrapToken: bt2.bootstrapToken,
        publicKey: keyPair2.publicKey,
      });
      expect.unreachable("second enrollment should have been rejected");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("invalid signature is rejected at exchange", async () => {
    // Setup
    const owner = await seedUser(auth);
    const org = await seedOrg(db, auth, owner.userId);
    const operatorCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const publicCaller = createPublicCaller(db, auth);

    // Create agent, issue bootstrap token, enroll with keyPair1
    const agentId = await insertUnenrolledAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const bt = await operatorCaller.auth.issueBootstrapToken({ agentId });
    const keyPair1 = await generateEd25519KeyPair();
    await publicCaller.auth.enroll({
      bootstrapToken: bt.bootstrapToken,
      publicKey: keyPair1.publicKey,
    });

    // Request a challenge
    const challengeResult = await publicCaller.auth.createChallenge({ agentId });

    // Sign with WRONG key (keyPair2)
    const keyPair2 = await generateEd25519KeyPair();
    const badSignature = await signEd25519(keyPair2.privateKey, challengeResult.challenge);

    try {
      await publicCaller.auth.exchangeSession({
        agentId,
        challengeId: challengeResult.challengeId,
        challenge: challengeResult.challenge,
        signature: badSignature,
      });
      expect.unreachable("exchange should have been rejected with invalid signature");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("FORBIDDEN");
    }
  });

  test("revoked agent session is rejected", async () => {
    // Setup: full flow through to session exchange
    const owner = await seedUser(auth);
    const org = await seedOrg(db, auth, owner.userId);
    const operatorCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const publicCaller = createPublicCaller(db, auth);

    const agentId = await insertUnenrolledAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
    });
    const bt = await operatorCaller.auth.issueBootstrapToken({ agentId });
    const keyPair = await generateEd25519KeyPair();
    await publicCaller.auth.enroll({
      bootstrapToken: bt.bootstrapToken,
      publicKey: keyPair.publicKey,
    });

    const challengeResult = await publicCaller.auth.createChallenge({ agentId });
    const signature = await signEd25519(keyPair.privateKey, challengeResult.challenge);
    const sessionResult = await publicCaller.auth.exchangeSession({
      agentId,
      challengeId: challengeResult.challengeId,
      challenge: challengeResult.challenge,
      signature,
    });
    const sessionToken = sessionResult.session.token;

    // Verify session works
    const agentCaller = createAgentCaller(db, auth, sessionToken);
    const selfResult = await agentCaller.agents.self();
    expect(selfResult.agent.id).toBe(agentId);

    // Revoke the session
    await operatorCaller.auth.revokeSession({ token: sessionToken });

    // Attempt to use the revoked session
    const revokedCaller = createAgentCaller(db, auth, sessionToken);
    try {
      await revokedCaller.agents.self();
      expect.unreachable("revoked session should have been rejected");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("UNAUTHORIZED");
    }
  });
});
