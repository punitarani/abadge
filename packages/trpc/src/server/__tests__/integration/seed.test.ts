import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { agents, agentSessions, items, member, organization, principals } from "@abadge/db/schema";
import { AGENT_SESSION_PREFIX } from "@abadge/core";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedServerItem,
  seedUser,
} from "../helpers/seed";

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
  test("seedUser creates a user with a valid session token", async () => {
    const auth = createTestAuth(db);
    const { userId, email, name, headers } = await seedUser(auth);

    expect(userId).toBeDefined();
    expect(email).toContain("@test.local");
    expect(name).toBe("Test User");

    const authHeader = headers.get("authorization");
    expect(authHeader).toBeDefined();
    expect(authHeader!.startsWith("Bearer ")).toBe(true);
    // Token portion should be non-empty
    expect(authHeader!.replace("Bearer ", "").length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // seedOrg
  // -----------------------------------------------------------------------
  test("seedOrg creates an org with the user as owner", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId, slug } = await seedOrg(db, auth, userId);

    // Verify organization row exists
    const [org] = await db.select().from(organization).where(eq(organization.id, orgId));
    expect(org).toBeDefined();
    expect(org.slug).toBe(slug);

    // Verify member row with "owner" role
    const [mem] = await db
      .select()
      .from(member)
      .where(eq(member.organizationId, orgId));
    expect(mem).toBeDefined();
    expect(mem.userId).toBe(userId);
    expect(mem.role).toBe("owner");
  });

  // -----------------------------------------------------------------------
  // seedAgent — dual insert into principals + agents
  // -----------------------------------------------------------------------
  test("seedAgent inserts into both principals and agents tables", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId } = await seedOrg(db, auth, userId);

    const { agentId, name, apiKey } = await seedAgent(db, {
      userId,
      orgId,
      authMethod: "legacy_api_key",
    });

    expect(agentId).toBeDefined();
    expect(apiKey).toBeDefined();

    // Verify principals row
    const [principal] = await db
      .select()
      .from(principals)
      .where(eq(principals.id, agentId));
    expect(principal).toBeDefined();
    expect(principal.name).toBe(name);
    expect(principal.userId).toBe(userId);
    expect(principal.secretHash).toBeDefined();
    expect(principal.secretPrefix).toBeDefined();

    // Verify agents row with same id
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));
    expect(agent).toBeDefined();
    expect(agent.name).toBe(name);
    expect(agent.organizationId).toBe(orgId);
    expect(agent.createdBy).toBe(userId);
    expect(agent.secretHash).toBe(principal.secretHash);
  });

  test("seedAgent with public_key_session returns a keyPair", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId } = await seedOrg(db, auth, userId);

    const { agentId, keyPair, apiKey } = await seedAgent(db, {
      userId,
      orgId,
      authMethod: "public_key_session",
    });

    expect(apiKey).toBeUndefined();
    expect(keyPair).toBeDefined();
    expect(keyPair!.publicKey).toBeDefined();
    expect(keyPair!.privateKey).toBeDefined();

    // Public key stored in both tables
    const [principal] = await db
      .select()
      .from(principals)
      .where(eq(principals.id, agentId));
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));

    expect(principal.publicKey).toBe(keyPair!.publicKey);
    expect(agent.publicKey).toBe(keyPair!.publicKey);
  });

  // -----------------------------------------------------------------------
  // seedAgentSession
  // -----------------------------------------------------------------------
  test("seedAgentSession creates a valid abs_-prefixed session token", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId } = await seedOrg(db, auth, userId);
    const { agentId } = await seedAgent(db, { userId, orgId });

    const { sessionId, rawToken } = await seedAgentSession(db, {
      agentId,
      userId,
    });

    expect(sessionId).toBeDefined();
    expect(rawToken.startsWith(AGENT_SESSION_PREFIX)).toBe(true);

    // Verify session row exists
    const [session] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId));
    expect(session).toBeDefined();
    expect(session.agentId).toBe(agentId);
    expect(session.userId).toBe(userId);
    expect(session.tokenHash).toBeDefined();
    expect(session.tokenHash.length).toBeGreaterThan(0);
    // tokenHash should NOT be the raw token (it's hashed)
    expect(session.tokenHash).not.toBe(rawToken);
    // expiresAt should be in the future
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // -----------------------------------------------------------------------
  // seedServerItem
  // -----------------------------------------------------------------------
  test("seedServerItem creates an encrypted item with non-null serverCiphertext", async () => {
    const auth = createTestAuth(db);
    const { userId } = await seedUser(auth);
    const { orgId } = await seedOrg(db, auth, userId);

    const { itemId, label } = await seedServerItem(db, { userId, orgId });

    expect(itemId).toBeDefined();
    expect(label).toBeDefined();

    // Verify item row
    const [item] = await db.select().from(items).where(eq(items.id, itemId));
    expect(item).toBeDefined();
    expect(item.storageMode).toBe("server_managed");
    expect(item.serverCiphertext).not.toBeNull();
    expect(item.serverCiphertext!.length).toBeGreaterThan(0);
    expect(item.serverIv).not.toBeNull();
    expect(item.serverKeyVersion).toBe(1);

    // ZK fields should be null
    expect(item.encryptedItemKey).toBeNull();
    expect(item.ciphertext).toBeNull();
  });
});
