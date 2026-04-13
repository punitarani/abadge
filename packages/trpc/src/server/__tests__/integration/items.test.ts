import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { items } from "@abadge/db/schema";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
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
