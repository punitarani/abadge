import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { seedOrg, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createOperatorCaller } from "../helpers/test-callers";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

describe("test callers", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    await truncateAll();
  });

  test("operator caller resolves session and lists agents (empty)", async () => {
    const userResult = await seedUser(auth);
    const orgResult = await seedOrg(db, auth, userResult.userId);
    const caller = createOperatorCaller(db, auth, userResult.headers, orgResult.orgId);

    const result = await caller.agents.list();
    expect(result.agents).toEqual([]);
  });
});
