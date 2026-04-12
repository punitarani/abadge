import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "@abadge/db";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("test database", () => {
  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("connects and runs a query", async () => {
    const db = getTestDb();
    const rows = await db.execute(sql`SELECT 1 AS n`);
    expect(rows[0]?.n).toBe(1);
  });

  test("truncateAll runs without error on empty tables", async () => {
    await truncateAll();
  });
});

describe("test auth", () => {
  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("creates a user via signUp and returns a session", async () => {
    const db = getTestDb();
    const auth = createTestAuth(db);

    const result = await auth.api.signUpEmail({
      body: {
        email: "alice@test.com",
        password: "test-password-123!",
        name: "Alice",
      },
    });

    expect(result).toBeDefined();
    expect(result.user).toBeDefined();
    expect(result.user.email).toBe("alice@test.com");
    expect(result.user.name).toBe("Alice");
    expect(result.token).toBeDefined();
  });
});
