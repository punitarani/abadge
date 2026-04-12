import { describe, expect, test, beforeAll, afterEach } from "bun:test";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";
import { sql } from "drizzle-orm";

describe("test database", () => {
  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("connects and runs a query", async () => {
    const db = getTestDb();
    const [row] = await db.execute(sql`SELECT 1 AS n`);
    expect(row.n).toBe(1);
  });

  test("truncateAll runs without error on empty tables", async () => {
    await truncateAll();
  });
});
