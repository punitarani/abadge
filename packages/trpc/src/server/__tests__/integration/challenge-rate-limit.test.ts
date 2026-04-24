/**
 * §R5 §DoS1 — auth.createChallenge rate-limit + GC regression tests
 *
 * Covers:
 *   §R5  — per-agent rate-limit: 30 live challenges max; 31st rejected with RATE_LIMITED
 *   §DoS1 — opportunistic GC: expired rows older than 1h deleted on next insert
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { generateEd25519KeyPair } from "@abadge/crypto/shared";
import { agentSessionChallenges } from "@abadge/db/schema";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("auth.createChallenge rate-limit + GC (§R5 §DoS1)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // §R5 — 30 challenges OK, 31st rejected with RATE_LIMITED
  // -------------------------------------------------------------------------

  test("§R5: 30 challenges succeed, 31st is rejected with RATE_LIMITED", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "Org", slug: "org" });
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);
    const kp = await generateEd25519KeyPair();

    const { agent } = await caller.agents.create({
      kind: "remote",
      name: "test-agent",
      authMethod: "public_key_session",
      publicKey: kp.publicKey,
    });

    // Fire 30 challenges — all should succeed.
    for (let i = 0; i < 30; i++) {
      const r = await caller.auth.createChallenge({ agentId: agent.id });
      expect(r.challenge).toBeTruthy();
    }

    // 31st must fail with RATE_LIMITED.
    try {
      await caller.auth.createChallenge({ agentId: agent.id });
      expect.unreachable("31st createChallenge should have thrown RATE_LIMITED");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.cause?.code ?? err.code).toBe("RATE_LIMITED");
    }
  });

  // -------------------------------------------------------------------------
  // §DoS1 — opportunistic GC removes old expired rows on next insert
  // -------------------------------------------------------------------------

  test("§DoS1: expired rows older than 1h are purged on next createChallenge", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId, { name: "Org2", slug: "org2" });
    const caller = createOperatorCaller(db, auth, user.headers, org.orgId);
    const kp = await generateEd25519KeyPair();

    const { agent } = await caller.agents.create({
      kind: "remote",
      name: "test-agent",
      authMethod: "public_key_session",
      publicKey: kp.publicKey,
    });

    // Manually insert an old expired row (2h past expiry — well beyond the 1h GC threshold).
    await db.insert(agentSessionChallenges).values({
      id: crypto.randomUUID(),
      agentId: agent.id,
      challengeHash: "old-hash",
      expiresAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    // Verify the stale row is present before the next call.
    let rows = await db.select().from(agentSessionChallenges);
    expect(rows).toHaveLength(1);

    // Creating a new challenge should trigger GC and delete the old row.
    await caller.auth.createChallenge({ agentId: agent.id });

    // Old row gone; only the freshly-created challenge remains.
    rows = await db.select().from(agentSessionChallenges);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.challengeHash).not.toBe("old-hash");
  });
});
