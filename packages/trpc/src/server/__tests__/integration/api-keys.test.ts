import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { UserApiKey } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { auditLogs, userApiKeys } from "@abadge/db/schema";
import { seedMember, seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// A personal `abu_` key is sent as a plain Bearer token, so `createAgentCaller`
// (which only sets `Authorization: Bearer <token>`) doubles as the "call the API
// with this api key" helper. It resolves to a SESSION identity, not an agent.
const createApiKeyCaller = createAgentCaller;

describe("apiKeys router", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("create returns a one-time abu_ secret that is not re-readable via list", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.apiKeys.create({ name: "ci-bot" });

    expect(created.key.startsWith("abu_")).toBe(true);
    expect(created.apiKey.name).toBe("ci-bot");
    expect(created.apiKey.keyPrefix.startsWith("abu_")).toBe(true);
    // The serialized key carries no secret material.
    expect(JSON.stringify(created.apiKey)).not.toContain(created.key);

    const listed = await caller.apiKeys.list();
    expect(listed.apiKeys).toHaveLength(1);
    expect(listed.apiKeys[0]?.id).toBe(created.apiKey.id);
    // The raw secret is never returned by list.
    expect(JSON.stringify(listed.apiKeys)).not.toContain(created.key);
  });

  test("list is scoped to the calling user, not the whole org", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const member = await seedUser(auth);
    await seedMember(auth, org.orgId, member.userId, "member");

    const ownerCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const memberCaller = createOperatorCaller(db, auth, member.headers, org.orgId);

    await ownerCaller.apiKeys.create({ name: "owner-key" });
    await memberCaller.apiKeys.create({ name: "member-key" });

    const ownerList = await ownerCaller.apiKeys.list();
    const memberList = await memberCaller.apiKeys.list();

    expect(ownerList.apiKeys.map((k: UserApiKey) => k.name)).toEqual(["owner-key"]);
    expect(memberList.apiKeys.map((k: UserApiKey) => k.name)).toEqual(["member-key"]);
  });

  test("revoke disables the key and is idempotent (second revoke is NOT_FOUND)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.apiKeys.create({ name: "to-revoke" });

    const result = await caller.apiKeys.revoke({ keyId: created.apiKey.id });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select({ revokedAt: userApiKeys.revokedAt, enabled: userApiKeys.enabled })
      .from(userApiKeys)
      .where(eq(userApiKeys.id, created.apiKey.id));
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.enabled).toBe(false);

    try {
      await caller.apiKeys.revoke({ keyId: created.apiKey.id });
      expect.unreachable("second revoke should be NOT_FOUND");
    } catch (error: unknown) {
      const err = error as { code?: string; cause?: { code?: string } };
      expect(err.code).toBe("NOT_FOUND");
    }
  });

  test("a user cannot revoke another user's key", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const member = await seedUser(auth);
    await seedMember(auth, org.orgId, member.userId, "member");

    const ownerCaller = createOperatorCaller(db, auth, owner.headers, org.orgId);
    const memberCaller = createOperatorCaller(db, auth, member.headers, org.orgId);

    const ownerKey = await ownerCaller.apiKeys.create({ name: "owner-only" });

    try {
      await memberCaller.apiKeys.revoke({ keyId: ownerKey.apiKey.id });
      expect.unreachable("member should not revoke the owner's key");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("NOT_FOUND");
    }

    // The owner's key is untouched.
    const [row] = await db
      .select({ revokedAt: userApiKeys.revokedAt })
      .from(userApiKeys)
      .where(eq(userApiKeys.id, ownerKey.apiKey.id));
    expect(row?.revokedAt).toBeNull();
  });

  // ---- Security regression: structural isolation from the agent surface ----

  test("an abu_ key authenticates the management surface but NEVER access.*", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.apiKeys.create({ name: "mgmt-key" });
    const keyCaller = createApiKeyCaller(db, auth, created.key);

    // Management surface works (resolves to a session identity).
    const listed = await keyCaller.apiKeys.list();
    expect(listed.apiKeys.map((k: UserApiKey) => k.id)).toContain(created.apiKey.id);
    await expect(keyCaller.agents.list({})).resolves.toBeDefined();

    // The agent-gated secret surface is unreachable: resolveAgentIdentity only
    // accepts abs_ sessions, so an abu_ bearer is rejected as unauthorized.
    try {
      await keyCaller.access.read({ itemId: "00000000-0000-0000-0000-000000000000" });
      expect.unreachable("an abu_ key must not reach access.read");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  test("an abu_ key cannot mint or revoke API keys; an interactive session can", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.apiKeys.create({ name: "self-mgmt" });
    const keyCaller = createApiKeyCaller(db, auth, created.key);

    try {
      await keyCaller.apiKeys.create({ name: "minted-by-key" });
      expect.unreachable("an api key must not mint another key");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("FORBIDDEN");
    }

    try {
      await keyCaller.apiKeys.revoke({ keyId: created.apiKey.id });
      expect.unreachable("an api key must not revoke keys");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("FORBIDDEN");
    }

    // The interactive (cookie-session) owner can revoke it fine.
    await expect(caller.apiKeys.revoke({ keyId: created.apiKey.id })).resolves.toEqual({
      ok: true,
    });
  });

  // ---- Auth-time expiry enforcement ----

  test("an expired key is rejected with UNAUTHORIZED at authentication time", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.apiKeys.create({ name: "expiry-test" });
    // Backdate expiresAt directly in the DB to simulate a past-expiry key.
    await db
      .update(userApiKeys)
      .set({ expiresAt: new Date(0) })
      .where(eq(userApiKeys.id, created.apiKey.id));

    const keyCaller = createApiKeyCaller(db, auth, created.key);
    try {
      await keyCaller.apiKeys.list();
      expect.unreachable("expired key must be rejected");
    } catch (error: unknown) {
      const err = error as { code?: string };
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  // ---- Audit ----

  test("create and revoke write append-only audit rows", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.apiKeys.create({ name: "audited" });
    await caller.apiKeys.revoke({ keyId: created.apiKey.id });

    const rows = await db
      .select({ eventType: auditLogs.eventType, result: auditLogs.result })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, org.orgId), eq(auditLogs.userId, owner.userId)));

    const events = rows.map((r) => `${r.eventType}:${r.result}`);
    expect(events).toContain("user_api_key.create:allowed");
    expect(events).toContain("user_api_key.revoke:allowed");
  });
});
