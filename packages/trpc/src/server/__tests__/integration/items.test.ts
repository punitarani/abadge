import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { items, profiles } from "@abadge/db/schema";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("items CRUD", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("create server_managed item and retrieve it", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "my-secret",
        kind: "opaque",
        tags: ["test"],
        fields: { token: "abc123" },
      },
    });

    expect(created.id).toBeTruthy();

    const result = await caller.items.get({ itemId: created.id });
    expect(result.item.label).toBe("my-secret");
    expect(result.item.storageMode).toBe("server_managed");
  });

  test("§AB-0030: new server_managed writes land as v3 under a per-profile DEK and round-trip", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "aad-item",
        kind: "opaque",
        tags: [],
        fields: { token: "bound-to-item" },
      },
    });

    const [row] = await db.select().from(items).where(eq(items.id, created.id));
    expect(row).toBeDefined();
    // §AB-0030 — new writes are the per-profile envelope (v3), not direct-key v2.
    expect(row?.serverKeyVersion).toBe(3);

    // The target profile now holds a wrapped DEK — content is encrypted under it,
    // not directly under ENCRYPTION_KEY (acceptance #1).
    const [profile] = await db
      .select({ dek: profiles.serverWrappedDek })
      .from(profiles)
      .where(eq(profiles.id, row?.profileId ?? ""));
    expect(profile?.dek).toBeTruthy();

    const revealed = await caller.items.ownerReveal({ itemId: created.id });
    expect((revealed.payload.fields as Record<string, string>).token).toBe("bound-to-item");
  });

  test("§W1S7-002: updating a v1 server_managed row rewrites as AAD-bound v2", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // seedServerItem writes legacy v1 ciphertext (no AAD, keyVersion = 1).
    const seeded = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      label: "legacy-v1",
      fields: { value: "pre-aad" },
    });

    const [before] = await db.select().from(items).where(eq(items.id, seeded.itemId));
    expect(before?.serverKeyVersion).toBe(1);

    // Owner reveal must still succeed against a v1 row (backward compat).
    const revealedV1 = await caller.items.ownerReveal({ itemId: seeded.itemId });
    expect((revealedV1.payload.fields as Record<string, string>).value).toBe("pre-aad");

    // Update rewrites the row as v2 AAD-bound.
    await caller.items.update({
      itemId: seeded.itemId,
      data: {
        storageMode: "server_managed",
        payload: {
          v: 1,
          label: "legacy-v1",
          kind: "opaque",
          tags: [],
          fields: { value: "post-aad" },
        },
        contentVersion: 1,
      },
    });

    const [after] = await db.select().from(items).where(eq(items.id, seeded.itemId));
    expect(after?.serverKeyVersion).toBe(2);

    const revealedV2 = await caller.items.ownerReveal({ itemId: seeded.itemId });
    expect((revealedV2.payload.fields as Record<string, string>).value).toBe("post-aad");
  });

  test("update item with optimistic concurrency", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "concurrency-item",
        kind: "opaque",
        tags: [],
        fields: { value: "original" },
      },
    });

    // Update with contentVersion: 1 — should succeed and return contentVersion: 2
    const updated = await caller.items.update({
      itemId: created.id,
      data: {
        storageMode: "server_managed",
        payload: {
          v: 1,
          label: "concurrency-item",
          kind: "opaque",
          tags: [],
          fields: { value: "updated" },
        },
        contentVersion: 1,
      },
    });

    expect(updated.contentVersion).toBe(2);

    // Attempt update with stale contentVersion: 1 — should throw
    try {
      await caller.items.update({
        itemId: created.id,
        data: {
          storageMode: "server_managed",
          payload: {
            v: 1,
            label: "concurrency-item",
            kind: "opaque",
            tags: [],
            fields: { value: "stale" },
          },
          contentVersion: 1,
        },
      });
      expect.unreachable("stale contentVersion update should have thrown");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("CONFLICT");
    }
  });

  test("owner reveal returns decrypted payload", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "reveal-item",
        kind: "opaque",
        tags: [],
        fields: { token: "secret-value" },
      },
    });

    const revealed = await caller.items.ownerReveal({ itemId: created.id });
    expect(revealed.payload.fields).toBeDefined();
    expect((revealed.payload.fields as Record<string, string>).token).toBe("secret-value");
  });

  test("delete item soft-deletes it", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "delete-me",
        kind: "opaque",
        tags: [],
        fields: { key: "value" },
      },
    });

    const itemId = created.id;

    await caller.items.delete({ itemId });

    // items.get should throw not found after deletion
    try {
      await caller.items.get({ itemId });
      expect.unreachable("items.get should have thrown after deletion");
    } catch (error: unknown) {
      const trpcError = error as { code?: string };
      expect(trpcError.code).toBe("NOT_FOUND");
    }

    // Directly verify deletedAt is set in the DB
    const [row] = await db.select().from(items).where(eq(items.id, itemId)).limit(1);
    expect(row).toBeDefined();
    expect(row?.deletedAt).toBeTruthy();
  });

  test("list items excludes soft-deleted items", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const item1 = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "keep-item",
        kind: "opaque",
        tags: [],
        fields: { a: "1" },
      },
    });

    const item2 = await caller.items.create({
      storageMode: "server_managed",
      payload: {
        v: 1,
        label: "delete-item",
        kind: "opaque",
        tags: [],
        fields: { b: "2" },
      },
    });

    await caller.items.delete({ itemId: item2.id });

    const result = await caller.items.list();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(item1.id);
  });
});

describe("items.listForAgent permission scoping", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("returns zero items when the agent has no permissions granted", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      label: "item-a",
    });
    await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      label: "item-b",
    });

    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });
    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.items.listForAgent();
    expect(result.items).toHaveLength(0);
  });

  test("returns only items the agent has any permission on", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const allowedItem = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      label: "allowed",
    });
    const forbiddenItem = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      label: "forbidden",
    });

    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "remote",
    });

    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: allowedItem.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.items.listForAgent();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(allowedItem.itemId);
    // Sanity: the forbidden item is not in the list
    expect(result.items.find((i: { id: string }) => i.id === forbiddenItem.itemId)).toBeUndefined();
  });

  test("returns distinct items even when the agent has multiple capabilities on one item", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);

    const item = await seedServerItem(db, {
      userId: owner.userId,
      orgId: org.orgId,
      label: "multi-cap",
    });

    const agent = await seedAgent(db, {
      userId: owner.userId,
      orgId: org.orgId,
      kind: "local_cli",
    });

    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: owner.userId,
    });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "mount_env",
      grantedBy: owner.userId,
    });

    const session = await seedAgentSession(db, {
      agentId: agent.agentId,
      userId: owner.userId,
    });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const result = await agentCaller.items.listForAgent();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(item.itemId);
  });
});
