import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * §AB-0050 — cursor pagination on items/permissions/agents. Pages must be
 * stable and non-overlapping under the (createdAt DESC, id DESC) keyset.
 */
describe("list cursor pagination (AB-0050)", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("items.list returns every row exactly once across cursor pages (no dupes, no gaps)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    const created: string[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await caller.items.create({
        storageMode: "server_managed",
        payload: { v: 1, label: `item-${i}`, kind: "opaque", tags: [], fields: { k: String(i) } },
      });
      created.push(r.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await caller.items.list({ limit: 3, cursor });
      expect(page.items.length).toBeLessThanOrEqual(3);
      for (const it of page.items) seen.push(it.id);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
      if (pages > 10) throw new Error("pagination did not terminate");
    } while (cursor);

    expect(pages).toBe(3); // 3 + 3 + 1
    expect(seen.length).toBe(7);
    expect(new Set(seen).size).toBe(7); // no duplicates across pages
    expect([...seen].sort()).toEqual([...created].sort()); // no gaps
  });

  test("limit at the 100 ceiling is accepted", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // 100 is the schema ceiling — an in-range request returns a single full page here.
    const page = await caller.items.list({ limit: 100 });
    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBeNull();
  });

  test("limit above the 100 ceiling is rejected by input validation", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

    // A value over the ceiling is a hard BAD_REQUEST, not a silent clamp — the
    // caller learns it asked for too much rather than quietly getting a
    // different page size. (Effect Schema: "less than or equal to 100".)
    await expect(caller.items.list({ limit: 200 })).rejects.toMatchObject({
      name: "TRPCError",
      code: "BAD_REQUEST",
    });
  });
});
