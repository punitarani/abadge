import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { items } from "@abadge/db/schema";
import { scopedDb } from "../../scoped-db";
import { seedOrg, seedServerItem, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// §AB-0010 — the scoped data-access layer must make a forgotten WHERE clause
// structurally impossible: every read is org-filtered by construction, every
// insert sets organizationId, and a cross-org row is unreachable even by id.
describe("§AB-0010 scopedDb — org-scoped data-access layer", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  async function twoOrgs() {
    const userA = await seedUser(auth);
    const orgA = await seedOrg(auth, userA.userId);
    const userB = await seedUser(auth);
    const orgB = await seedOrg(auth, userB.userId);
    const itemA = await seedServerItem(db, {
      userId: userA.userId,
      orgId: orgA.orgId,
      label: "a-item",
    });
    const itemB = await seedServerItem(db, {
      userId: userB.userId,
      orgId: orgB.orgId,
      label: "b-item",
    });
    return { orgA, orgB, itemA, itemB, userA, userB };
  }

  test("findMany returns only the scoped org's rows", async () => {
    const s = await twoOrgs();
    const rows = await scopedDb(db, s.orgA.orgId).findMany("items");
    expect(rows.map((r) => r.id)).toEqual([s.itemA.itemId]);
  });

  test("findFirst cannot reach another org's row even when targeted by id", async () => {
    const s = await twoOrgs();
    // Explicitly target org B's item by primary key; the baked-in org scope must
    // still exclude it — this is the cross-tenant leak the layer prevents.
    const row = await scopedDb(db, s.orgA.orgId).findFirst("items", {
      where: eq(items.id, s.itemB.itemId),
    });
    expect(row).toBeUndefined();
  });

  test("insert injects organizationId automatically", async () => {
    const s = await twoOrgs();
    const scope = scopedDb(db, s.orgA.orgId);
    await scope.insert("items", {
      id: crypto.randomUUID(),
      createdBy: s.userA.userId,
      label: "scoped-insert",
      storageMode: "server_managed",
      serverCiphertext: "ct",
      serverIv: "iv",
      serverKeyVersion: 1,
    });
    const inserted = (await scope.findMany("items")).find((r) => r.label === "scoped-insert");
    expect(inserted?.organizationId).toBe(s.orgA.orgId);
  });

  test("run executes inside a transaction with a tx-bound scope", async () => {
    const s = await twoOrgs();
    const count = await scopedDb(db, s.orgA.orgId).run(async (txScope) => {
      const rows = await txScope.findMany("items");
      return rows.length;
    });
    expect(count).toBe(1);
  });

  test("orgScope + tables (escape hatch) is still org-bound", async () => {
    const s = await twoOrgs();
    const scope = scopedDb(db, s.orgA.orgId);
    const rows = await scope.executor
      .select()
      .from(scope.tables.items)
      .where(scope.orgScope("items"));
    expect(rows.map((r) => r.id)).toEqual([s.itemA.itemId]);
  });
});
