import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { AGENT_SESSION_PREFIX } from "@abadge/core";
import { eq } from "@abadge/db";
import { agentSessions, agents, items, member, organization } from "@abadge/db/schema";
import { seedAgent, seedAgentSession, seedOrg, seedServerItem, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/** Type-narrowing assert: throws if value is nullish, returns narrowed T. */
function assertDefined<T>(val: T | null | undefined, label = "value"): T {
  if (val == null) throw new Error(`Expected ${label} to be defined`);
  return val;
}

const db = getTestDb();

describe("seed factories", () => {
  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  // -----------------------------------------------------------------------
  // seedUser
  // -----------------------------------------------------------------------
  test("seedUser creates a user with a valid session", async () => {
    const auth = createTestAuth(db);
    const { userId, email, name, headers, token } = await seedUser(auth);

    expect(userId).toBeDefined();
    expect(email).toContain("@test.local");
    expect(name).toBe("Test User");

    // testUtils.login() returns cookie-based headers
    const cookieHeader = headers.get("cookie");
    expect(cookieHeader).toBeTruthy();
    expect(cookieHeader).toContain("better-auth.session_token=");

    // Raw session token also available for Bearer-path testing
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // seedOrg
  // -----------------------------------------------------------------------
  test("seedOrg creates an org with the user as owner", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId, slug } = await seedOrg(auth, userId);

    const org = assertDefined(
      (await db.select().from(organization).where(eq(organization.id, orgId)))[0],
      "organization row",
    );
    expect(org.slug).toBe(slug);

    const mem = assertDefined(
      (await db.select().from(member).where(eq(member.organizationId, orgId)))[0],
      "member row",
    );
    expect(mem.userId).toBe(userId);
    expect(mem.role).toBe("owner");
  });

  // -----------------------------------------------------------------------
  // seedAgent — inserts into agents table
  // -----------------------------------------------------------------------
  test("seedAgent inserts a public_key_session agent with the returned keyPair", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId } = await seedOrg(auth, userId);

    const { agentId, name, keyPair } = await seedAgent(db, { userId, orgId });

    expect(agentId).toBeDefined();
    const kp = assertDefined(keyPair, "keyPair");
    expect(kp.publicKey).toBeDefined();
    expect(kp.privateKey).toBeDefined();

    const agent = assertDefined(
      (await db.select().from(agents).where(eq(agents.id, agentId)))[0],
      "agents row",
    );
    expect(agent.name).toBe(name);
    expect(agent.organizationId).toBe(orgId);
    expect(agent.createdBy).toBe(userId);
    expect(agent.authMethod).toBe("public_key_session");
    expect(agent.publicKey).toBe(kp.publicKey);
  });

  // -----------------------------------------------------------------------
  // seedAgentSession
  // -----------------------------------------------------------------------
  test("seedAgentSession creates a valid abs_-prefixed session token", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId } = await seedOrg(auth, userId);
    const { agentId } = await seedAgent(db, { userId, orgId });

    const { sessionId, rawToken } = await seedAgentSession(db, {
      agentId,
      userId,
    });

    expect(sessionId).toBeDefined();
    expect(rawToken.startsWith(AGENT_SESSION_PREFIX)).toBe(true);

    const session = assertDefined(
      (await db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)))[0],
      "agent_sessions row",
    );
    expect(session.agentId).toBe(agentId);
    expect(session.userId).toBe(userId);
    expect(session.tokenHash).toBeDefined();
    expect(session.tokenHash.length).toBeGreaterThan(0);
    expect(session.tokenHash).not.toBe(rawToken);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // -----------------------------------------------------------------------
  // seedServerItem
  // -----------------------------------------------------------------------
  test("seedServerItem creates an encrypted item with non-null serverCiphertext", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId } = await seedOrg(auth, userId);

    const { itemId, label } = await seedServerItem(db, { userId, orgId });

    expect(itemId).toBeDefined();
    expect(label).toBeDefined();

    const item = assertDefined(
      (await db.select().from(items).where(eq(items.id, itemId)))[0],
      "items row",
    );
    expect(item.storageMode).toBe("server_managed");
    expect(item.serverCiphertext).not.toBeNull();
    expect(item.serverCiphertext?.length).toBeGreaterThan(0);
    expect(item.serverIv).not.toBeNull();
    expect(item.serverKeyVersion).toBe(1);

    expect(item.encryptedItemKey).toBeNull();
    expect(item.ciphertext).toBeNull();
  });
});
