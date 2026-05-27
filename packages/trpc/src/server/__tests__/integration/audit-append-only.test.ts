import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { auditLogs } from "@abadge/db/schema";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * §AB-0020 — audit_logs is append-only at the database. Migration 0018 installs
 * a BEFORE UPDATE/DELETE trigger that RAISEs, so a bug, compromised Worker, or
 * insider cannot rewrite or delete audit rows. The trigger fires for all roles,
 * independent of the least-privilege app role (AB-0012, the complementary
 * REVOKE defense-in-depth).
 */
describe("audit_logs append-only trigger (AB-0020)", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    // truncateAll uses TRUNCATE, which bypasses the row trigger — so test
    // cleanup still works even though row UPDATE/DELETE are blocked.
    await truncateAll();
  });

  async function insertAuditRow(): Promise<number> {
    const [row] = await db
      .insert(auditLogs)
      .values({
        organizationId: "org_append_only",
        userId: "user_append_only",
        eventType: "item.read",
        result: "allowed",
      })
      .returning({ id: auditLogs.id });
    if (!row) throw new Error("expected an inserted audit row");
    return row.id;
  }

  test("INSERT into audit_logs still succeeds", async () => {
    const id = await insertAuditRow();
    expect(id).toBeGreaterThan(0);
  });

  test("UPDATE on an audit row is rejected by the immutability trigger", async () => {
    const id = await insertAuditRow();
    let threw = false;
    try {
      await db.update(auditLogs).set({ result: "denied" }).where(eq(auditLogs.id, id));
    } catch {
      // The mutation was rejected. The behavioral assertions below (row
      // unchanged / still present) prove it was the immutability trigger:
      // absent the trigger, a valid UPDATE/DELETE on an existing row would
      // succeed rather than throw.
      threw = true;
    }
    expect(threw).toBe(true);

    // The row is unchanged.
    const [row] = await db
      .select({ result: auditLogs.result })
      .from(auditLogs)
      .where(eq(auditLogs.id, id));
    expect(row?.result).toBe("allowed");
  });

  test("DELETE of an audit row is rejected by the immutability trigger", async () => {
    const id = await insertAuditRow();
    let threw = false;
    try {
      await db.delete(auditLogs).where(eq(auditLogs.id, id));
    } catch {
      // The mutation was rejected. The behavioral assertions below (row
      // unchanged / still present) prove it was the immutability trigger:
      // absent the trigger, a valid UPDATE/DELETE on an existing row would
      // succeed rather than throw.
      threw = true;
    }
    expect(threw).toBe(true);

    const rows = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, id));
    expect(rows).toHaveLength(1);
  });
});
