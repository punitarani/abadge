import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import process from "node:process";
import { createDb, sql } from "@abadge/db";
import { getTestDb, migrateTestDb } from "../helpers/test-db";

/**
 * §AB-0012 — the application runtime must connect as a least-privilege,
 * non-owner role. This proves the GRANT/REVOKE policy in
 * `scripts/least-privilege.sql`: the role is NOSUPERUSER/NOBYPASSRLS, can
 * do normal DML, and CANNOT mutate the audit trail (the TRUNCATE revoke closes
 * the gap the 0018 trigger can't — TRUNCATE bypasses row-level triggers).
 *
 * The role is created here under a unique name; production provisioning +
 * connection cutover is documented in docs/runbooks/least-privilege-db-role.md.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://abadge:abadge@localhost:5432/abadge_test";

const ROLE = `app_runtime_test_${Math.random().toString(36).slice(2, 10)}`;
const ROLE_PASSWORD = "least_priv_test_pw";

function restrictedConnectionUrl(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.username = ROLE;
  url.password = ROLE_PASSWORD;
  return url.toString();
}

function databaseName(): string {
  return new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
}

describe("least-privilege application role (§AB-0012)", () => {
  const owner = getTestDb();

  beforeAll(async () => {
    await migrateTestDb();
    const db = databaseName();
    // Provision the app role exactly as least-privilege.sql does (owner runs this).
    await owner.execute(sql.raw(`DROP ROLE IF EXISTS ${ROLE}`));
    await owner.execute(
      sql.raw(
        `CREATE ROLE ${ROLE} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB PASSWORD '${ROLE_PASSWORD}'`,
      ),
    );
    await owner.execute(sql.raw(`GRANT CONNECT ON DATABASE "${db}" TO ${ROLE}`));
    await owner.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${ROLE}`));
    await owner.execute(
      sql.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`),
    );
    await owner.execute(
      sql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`),
    );
    await owner.execute(sql.raw(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM ${ROLE}`));
  });

  afterAll(async () => {
    await owner.execute(sql.raw(`DROP OWNED BY ${ROLE}`));
    await owner.execute(sql.raw(`DROP ROLE IF EXISTS ${ROLE}`));
  });

  test("the grant policy is exactly append-only on audit_logs, full DML elsewhere", async () => {
    const priv = async (table: string, privilege: string): Promise<boolean> => {
      const rows = (await owner.execute(
        sql`SELECT has_table_privilege(${ROLE}, ${table}, ${privilege}) AS ok`,
      )) as unknown as Array<{ ok: boolean }>;
      return rows[0]?.ok === true;
    };

    // audit_logs: append + read only.
    expect(await priv("audit_logs", "INSERT")).toBe(true);
    expect(await priv("audit_logs", "SELECT")).toBe(true);
    expect(await priv("audit_logs", "UPDATE")).toBe(false);
    expect(await priv("audit_logs", "DELETE")).toBe(false);
    expect(await priv("audit_logs", "TRUNCATE")).toBe(false);

    // Other tables: full application DML.
    for (const op of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(await priv("items", op)).toBe(true);
      expect(await priv("profiles", op)).toBe(true);
    }
  });

  test("connecting as the role: not a superuser, cannot bypass RLS, cannot erase audit rows", async () => {
    const restricted = createDb(restrictedConnectionUrl());

    // drizzle's execute() returns a lazy thenable that bun's .resolves/.rejects
    // matchers mishandle; await it explicitly and capture the error.
    const denialMessage = async (stmt: ReturnType<typeof sql>): Promise<string> => {
      try {
        await restricted.execute(stmt);
        return "";
      } catch (error) {
        // drizzle wraps the pg error ("Failed query: …") and nests the real
        // "permission denied …" under `.cause`.
        const parts: string[] = [];
        if (error instanceof Error) {
          parts.push(error.message);
          const cause = (error as { cause?: unknown }).cause;
          parts.push(cause instanceof Error ? cause.message : String(cause ?? ""));
        } else {
          parts.push(String(error));
        }
        return parts.join(" | ");
      }
    };

    try {
      const roleRows = (await restricted.execute(
        sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      )) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
      expect(roleRows[0]?.rolsuper).toBe(false);
      expect(roleRows[0]?.rolbypassrls).toBe(false);

      // Normal reads work as the restricted role.
      const itemsCount = await restricted.execute(sql`SELECT count(*) FROM items`);
      expect(itemsCount).toBeDefined();

      // Every audit write verb is denied at the privilege layer — including
      // TRUNCATE, which the row-level immutability trigger cannot catch. The
      // privilege check fires before the trigger, so each statement fails with
      // "permission denied" rather than the trigger's raise.
      expect(await denialMessage(sql`UPDATE audit_logs SET result = result`)).toMatch(
        /permission denied/i,
      );
      expect(await denialMessage(sql`DELETE FROM audit_logs`)).toMatch(/permission denied/i);
      expect(await denialMessage(sql`TRUNCATE audit_logs`)).toMatch(/permission denied/i);
    } finally {
      await restricted.$client.end({ timeout: 5 });
    }
  });
});
