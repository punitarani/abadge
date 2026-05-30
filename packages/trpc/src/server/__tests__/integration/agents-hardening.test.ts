/**
 * agents.create hardening
 *
 * Covers: quota, metadata size/depth, combo mutex, name
 * whitespace/zero-width, publicKey format.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { MAX_AGENTS_PER_ORG } from "@abadge/core";
import { generateEd25519KeyPair } from "@abadge/crypto/shared";
import { agents } from "@abadge/db/schema";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("agents.create hardening", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // -------------------------------------------------------------------------
  // per-org count cap
  // -------------------------------------------------------------------------

  test("quota — agent creation is blocked at MAX_AGENTS_PER_ORG", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    // Bulk-seed MAX_AGENTS_PER_ORG agents directly into DB (one INSERT call).
    const rows = Array.from({ length: MAX_AGENTS_PER_ORG }, (_, i) => ({
      id: crypto.randomUUID(),
      organizationId: org.orgId,
      createdBy: owner.userId,
      name: `bulk-agent-${i}`,
      kind: "remote" as const,
      locality: "remote" as const,
      authMethod: "public_key_session" as const,
    }));
    await db.insert(agents).values(rows);

    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    try {
      await caller.agents.create({
        name: "one-too-many",
        kind: "remote",
        issueBootstrapToken: true,
      });
      expect.unreachable("should have thrown CONFLICT");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string; message?: string } };
      // tRPC wraps domain errors in a CONFLICT HTTP code
      expect(err.code ?? err.cause?.code).toMatch(/CONFLICT/);
      expect(err.cause?.message ?? (err as { message?: string }).message).toContain(
        String(MAX_AGENTS_PER_ORG),
      );
    }
  });

  // -------------------------------------------------------------------------
  // metadata size cap
  // -------------------------------------------------------------------------

  test("metadata size — rejects metadata exceeding 16 KB", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    try {
      await caller.agents.create({
        name: "size-bot",
        kind: "remote",
        issueBootstrapToken: true,
        metadata: { big: "x".repeat(20_000) },
      });
      expect.unreachable("should have thrown on oversized metadata");
    } catch (error: unknown) {
      // tRPC wraps schema validation as BAD_REQUEST
      const err = error as { code?: string };
      expect(err.code).toBe("BAD_REQUEST");
    }
  });

  // -------------------------------------------------------------------------
  // metadata depth cap
  // -------------------------------------------------------------------------

  test("metadata depth — rejects metadata nested more than 8 levels", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // Build a 10-level deep object: { a: { a: { ... } } }
    function buildDeep(depth: number): Record<string, unknown> {
      if (depth <= 0) return { leaf: "value" };
      return { a: buildDeep(depth - 1) };
    }
    const deepMeta = buildDeep(10);

    try {
      await caller.agents.create({
        name: "deep-bot",
        kind: "remote",
        issueBootstrapToken: true,
        metadata: deepMeta,
      });
      expect.unreachable("should have thrown on too-deep metadata");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("BAD_REQUEST");
    }
  });

  // -------------------------------------------------------------------------
  // publicKey + issueBootstrapToken combo is rejected
  // -------------------------------------------------------------------------

  test("combo mutex — public_key_session + publicKey + issueBootstrapToken is rejected", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const kp = await generateEd25519KeyPair();

    try {
      await caller.agents.create({
        name: "ambiguous-bot",
        kind: "remote",
        authMethod: "public_key_session",
        publicKey: kp.publicKey,
        issueBootstrapToken: true,
      });
      expect.unreachable("should have thrown on ambiguous combo");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("BAD_REQUEST");
    }
  });

  // -------------------------------------------------------------------------
  // whitespace-only name
  // -------------------------------------------------------------------------

  test("name whitespace — rejects whitespace-only name", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    try {
      await caller.agents.create({
        name: "   ",
        kind: "remote",
        issueBootstrapToken: true,
      });
      expect.unreachable("should have thrown on whitespace name");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("BAD_REQUEST");
    }
  });

  // -------------------------------------------------------------------------
  // zero-width character in name (U+200B zero-width space)
  // -------------------------------------------------------------------------

  test("name zero-width — rejects name containing zero-width chars", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    try {
      await caller.agents.create({
        // "bot" with a U+200B zero-width space inserted between b and o
        name: "b​ot",
        kind: "remote",
        issueBootstrapToken: true,
      });
      expect.unreachable("should have thrown on zero-width char in name");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("BAD_REQUEST");
    }
  });

  // -------------------------------------------------------------------------
  // publicKey format validation
  // -------------------------------------------------------------------------

  test("publicKey format — rejects non-JWK publicKey on create", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    try {
      await caller.agents.create({
        name: "bad-key-bot",
        kind: "remote",
        authMethod: "public_key_session",
        publicKey: "not_a_valid_jwk_or_base64",
      });
      expect.unreachable("should have thrown on invalid publicKey format");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("BAD_REQUEST");
    }
  });

  test("publicKey format — accepts valid JWK publicKey on create", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const kp = await generateEd25519KeyPair();

    // This should succeed
    const result = await caller.agents.create({
      name: "valid-key-bot",
      kind: "remote",
      authMethod: "public_key_session",
      publicKey: kp.publicKey,
    });
    expect(result.agent.id).toBeTruthy();
    expect(result.agent.publicKeyConfigured).toBe(true);
  });
});
