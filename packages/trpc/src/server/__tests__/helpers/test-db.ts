import { createDb, type Database } from "@abadge/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://abadge:abadge@localhost:5432/abadge_test";

let _db: Database | null = null;

export function getTestDb(): Database {
  if (!_db) {
    _db = createDb(TEST_DATABASE_URL);
  }
  return _db;
}

const migrationsFolder = path.resolve(
  import.meta.dir,
  "../../../../../db/migrations",
);

export async function migrateTestDb(): Promise<void> {
  const db = getTestDb();
  await migrate(db, { migrationsFolder });
}

/**
 * Truncate all application tables in a single statement.
 * Uses CASCADE to handle FK constraints.
 */
export async function truncateAll(): Promise<void> {
  const db = getTestDb();
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs,
      audit_log,
      agent_sessions,
      agent_session_challenges,
      agent_enrollment_tokens,
      permissions,
      grants,
      items,
      agents,
      principals,
      operator_tokens,
      profiles,
      vaults,
      "deviceCode",
      invitation,
      member,
      organization,
      verification,
      account,
      session,
      "user"
    CASCADE
  `);
}
