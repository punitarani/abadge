import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "@abadge/db";
import { auditLogs } from "@abadge/db/schema";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

/**
 * audit_logs is append-only at the database: migration 0018 installs a
 * BEFORE UPDATE/DELETE trigger that RAISEs, so audit rows cannot be rewritten
 * or deleted by any role.
 */
describe("audit_logs append-only trigger (AB-0020)", () => {
  const db = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
  });

  afterEach(async () => {
    // TRUNCATE bypasses the row trigger, so cleanup works despite the block.
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

  // SQLSTATE 23001 (restrict_violation) is what the trigger RAISEs. Drizzle
  // re-wraps the driver error with a generic message and the PostgresError on
  // `.cause`, so pin the assertion there — a connection-level failure would
  // carry a different (or no) code and fail this check instead of passing.
  async function expectRejectedByTrigger(op: PromiseLike<unknown>): Promise<void> {
    try {
      await op;
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      expect(cause?.code).toBe("23001");
      return;
    }
    throw new Error("expected the mutation to be rejected by the trigger");
  }

  test("UPDATE on an audit row is rejected by the immutability trigger", async () => {
    const id = await insertAuditRow();
    await expectRejectedByTrigger(
      db.update(auditLogs).set({ result: "denied" }).where(eq(auditLogs.id, id)),
    );

    const [row] = await db
      .select({ result: auditLogs.result })
      .from(auditLogs)
      .where(eq(auditLogs.id, id));
    expect(row?.result).toBe("allowed");
  });

  test("DELETE of an audit row is rejected by the immutability trigger", async () => {
    const id = await insertAuditRow();
    await expectRejectedByTrigger(db.delete(auditLogs).where(eq(auditLogs.id, id)));

    const rows = await db.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, id));
    expect(rows).toHaveLength(1);
  });
});
