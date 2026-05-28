import path from "node:path";
import { createDb, type Database, migrate, sql } from "@abadge/db";

const DEFAULT_TEST_DB = "postgresql://abadge:abadge@localhost:5432/abadge_test";
// biome-ignore lint/style/noRestrictedGlobals: test helper runs outside @abadge/env validation
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DB;

let _db: Database | null = null;

export function getTestDb(): Database {
  if (!_db) {
    _db = createDb(TEST_DATABASE_URL);
  }
  return _db;
}

const migrationsFolder = path.resolve(import.meta.dir, "../../../../../db/migrations");

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
      agent_sessions,
      agent_session_challenges,
      agent_enrollment_tokens,
      mount_reservations,
      permissions,
      items,
      agents,
      profiles,
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
