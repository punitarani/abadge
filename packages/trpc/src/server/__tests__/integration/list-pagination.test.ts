import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "@abadge/db";
import { items, permissions } from "@abadge/db/schema";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedProfile,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
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

  test("items.listForAgent pages the agent's grant set exactly once each (AB-0010)", async () => {
    const owner = await seedUser(auth);
    const org = await seedOrg(auth, owner.userId);
    const agent = await seedAgent(db, { userId: owner.userId, orgId: org.orgId, kind: "remote" });

    const granted: string[] = [];
    for (let i = 0; i < 7; i++) {
      const item = await seedServerItem(db, {
        userId: owner.userId,
        orgId: org.orgId,
        fields: { k: String(i) },
      });
      await seedPermission(db, {
        orgId: org.orgId,
        agentId: agent.agentId,
        itemId: item.itemId,
        capability: "reveal_plaintext",
        grantedBy: owner.userId,
      });
      granted.push(item.itemId);
    }

    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: owner.userId });
    const agentCaller = createAgentCaller(db, auth, session.rawToken);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await agentCaller.items.listForAgent({ limit: 3, cursor });
      expect(page.items.length).toBeLessThanOrEqual(3);
      for (const it of page.items) seen.push(it.id);
      cursor = page.nextCursor ?? undefined;
      pages += 1;
      if (pages > 10) throw new Error("pagination did not terminate");
    } while (cursor);

    expect(pages).toBe(3); // 3 + 3 + 1
    expect(new Set(seen).size).toBe(7); // no duplicates across pages
    expect([...seen].sort()).toEqual([...granted].sort()); // no gaps
  });

  // §AB-0052 — regression for the sub-millisecond cursor precision bug.
  // When >MAX_PAGE_LIMIT rows share an identical `created_at` (e.g. a single
  // transaction), page 2+ must not silently drop rows.
  describe("sub-millisecond cursor precision (AB-0052)", () => {
    const FIXED_TS = "2024-01-01 10:00:00.444588+00"; // has sub-ms component
    const N = 150; // page 1 = 100, page 2 = 50 — exercises the exact-match branch

    test("items.list returns all rows when created_at has sub-millisecond precision", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);
      const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

      // Batch-insert N items directly to avoid N×encrypt round trips.
      const { profileId } = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
      const itemValues = Array.from({ length: N }, (_, i) => ({
        id: crypto.randomUUID(),
        organizationId: org.orgId,
        profileId,
        createdBy: owner.userId,
        label: `bulk-${i}`,
        storageMode: "server_managed" as const,
        serverCiphertext: "x",
        serverIv: "x",
        serverKeyVersion: 1,
      }));
      await db.insert(items).values(itemValues);
      const allIds = itemValues.map((v) => v.id);

      // Force ALL items to the exact same sub-millisecond timestamp.
      await db.execute(
        sql`UPDATE items SET created_at = ${FIXED_TS}::timestamptz WHERE organization_id = ${org.orgId}`,
      );

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await caller.items.list({ limit: 100, cursor });
        for (const it of page.items) seen.push(it.id);
        cursor = page.nextCursor ?? undefined;
        pages += 1;
        if (pages > 10) throw new Error("pagination did not terminate");
      } while (cursor);

      expect(seen.length).toBe(N);
      expect(new Set(seen).size).toBe(N); // no duplicates
      expect([...seen].sort()).toEqual([...allIds].sort()); // no gaps
    });

    test("permissions.list returns all rows when created_at has sub-millisecond precision", async () => {
      const owner = await seedUser(auth);
      const org = await seedOrg(auth, owner.userId);
      const agent = await seedAgent(db, { userId: owner.userId, orgId: org.orgId, kind: "remote" });
      const caller = createOperatorCaller(db, auth, owner.headers, org.orgId);

      // One item per permission (unique-constraint requires distinct items).
      const { profileId } = await seedProfile(db, org.orgId, { storageMode: "server_managed" });
      const permIds: string[] = [];
      for (let i = 0; i < N; i++) {
        const item = await seedServerItem(db, {
          userId: owner.userId,
          orgId: org.orgId,
          profileId,
          fields: { k: String(i) },
        });
        const { permissionId } = await seedPermission(db, {
          orgId: org.orgId,
          agentId: agent.agentId,
          itemId: item.itemId,
          capability: "reveal_plaintext",
          grantedBy: owner.userId,
        });
        permIds.push(permissionId);
      }

      // Force all permissions to the same sub-millisecond timestamp.
      await db.execute(
        sql`UPDATE permissions SET created_at = ${FIXED_TS}::timestamptz WHERE organization_id = ${org.orgId}`,
      );

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const page = await caller.permissions.list({
          agentId: agent.agentId,
          limit: 100,
          cursor,
        });
        for (const p of page.permissions) seen.push(p.id);
        cursor = page.nextCursor ?? undefined;
        pages += 1;
        if (pages > 10) throw new Error("pagination did not terminate");
      } while (cursor);

      expect(seen.length).toBe(N);
      expect(new Set(seen).size).toBe(N); // no duplicates
      expect([...seen].sort()).toEqual([...permIds].sort()); // no gaps
    });
  });
});
