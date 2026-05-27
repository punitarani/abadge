import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, type Database, eq, sql } from "@abadge/db";
import { items } from "@abadge/db/schema";
import { seedOrg, seedServerItem, seedUser } from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { getTestDb, migrateTestDb, truncateAll } from "../helpers/test-db";

// §AB-0011 — the RLS backstop only enforces for NON-superuser, NON-BYPASSRLS roles
// (the default test role is superuser and bypasses RLS, which is why the rest of the
// suite is unaffected by enabling RLS). This test provisions a restricted role like
// the production `abadge_app` and proves: the org GUC isolates rows, a wrong/unset
// context FAILS CLOSED (zero rows, never an unfiltered leak), and the role genuinely
// cannot bypass RLS.
const TEST_DB_URL =
  // biome-ignore lint/style/noRestrictedGlobals: test helper runs outside @abadge/env
  process.env.TEST_DATABASE_URL ?? "postgresql://abadge:abadge@localhost:5432/abadge_test";
const RLS_ROLE = "abadge_rls_test";
const RLS_PASSWORD = "rls_test_pw";

function rlsRoleUrl(): string {
  const u = new URL(TEST_DB_URL);
  u.username = RLS_ROLE;
  u.password = RLS_PASSWORD;
  return u.toString();
}

describe("§AB-0011 — Postgres RLS backstop", () => {
  const db = getTestDb();
  const auth = createTestAuth(db);
  let rlsDb: Database;

  beforeAll(async () => {
    await migrateTestDb();
    // Provision a restricted login role (NOSUPERUSER NOBYPASSRLS) so RLS actually applies.
    await db.execute(sql`DROP ROLE IF EXISTS ${sql.raw(RLS_ROLE)}`);
    // DDL can't bind-parameter the password; RLS_ROLE/RLS_PASSWORD are test constants.
    await db.execute(
      sql.raw(`CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_PASSWORD}' NOSUPERUSER NOBYPASSRLS`),
    );
    await db.execute(sql`GRANT USAGE ON SCHEMA public TO ${sql.raw(RLS_ROLE)}`);
    await db.execute(
      sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${sql.raw(RLS_ROLE)}`,
    );
    rlsDb = createDb(rlsRoleUrl());
  });

  afterAll(async () => {
    try {
      await db.execute(sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${sql.raw(RLS_ROLE)}`);
      await db.execute(sql`REVOKE USAGE ON SCHEMA public FROM ${sql.raw(RLS_ROLE)}`);
      await db.execute(sql`DROP ROLE IF EXISTS ${sql.raw(RLS_ROLE)}`);
    } catch {
      // best-effort cleanup; the role is cluster-level and re-dropped on the next run
    }
  });

  test("the restricted role is NOSUPERUSER + NOBYPASSRLS (acceptance: cannot bypass RLS)", async () => {
    const [row] = await db.execute(
      sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${RLS_ROLE}`,
    );
    expect((row as { rolsuper: boolean }).rolsuper).toBe(false);
    expect((row as { rolbypassrls: boolean }).rolbypassrls).toBe(false);
  });

  test("RLS isolates rows by app.current_org, and a wrong/unset org fails closed", async () => {
    // Seed two orgs (as the superuser; RLS-bypassing, so the seed always lands).
    const userA = await seedUser(auth);
    const orgA = await seedOrg(auth, userA.userId);
    const itemA = await seedServerItem(db, { userId: userA.userId, orgId: orgA.orgId, label: "a" });
    const userB = await seedUser(auth);
    const orgB = await seedOrg(auth, userB.userId);
    const itemB = await seedServerItem(db, { userId: userB.userId, orgId: orgB.orgId, label: "b" });

    // Correct org context -> only that org's rows.
    const seenA = await rlsDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${orgA.orgId}, true)`);
      return tx.select({ id: items.id }).from(items);
    });
    expect(seenA.map((r) => r.id)).toEqual([itemA.itemId]);

    const seenB = await rlsDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${orgB.orgId}, true)`);
      return tx.select({ id: items.id }).from(items);
    });
    expect(seenB.map((r) => r.id)).toEqual([itemB.itemId]);

    // Cross-org: org A's context can never see org B's item, even targeting it by id.
    const crossOrg = await rlsDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${orgA.orgId}, true)`);
      return tx.select({ id: items.id }).from(items).where(eq(items.id, itemB.itemId));
    });
    expect(crossOrg).toEqual([]);

    // Unset context (GUC never set in this tx) -> FAIL CLOSED (zero rows), not a leak.
    const unset = await rlsDb.transaction(async (tx) => tx.select({ id: items.id }).from(items));
    expect(unset).toEqual([]);

    // A non-existent org -> zero rows.
    const wrong = await rlsDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', 'org-does-not-exist', true)`);
      return tx.select({ id: items.id }).from(items);
    });
    expect(wrong).toEqual([]);

    await truncateAll();
  });

  test("scopedDb.run sets the org GUC so the runtime app role sees its own rows", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);
    const item = await seedServerItem(db, { userId: user.userId, orgId: org.orgId, label: "x" });

    // Mirror what scopedDb.run does (SET LOCAL the GUC first), as the restricted role.
    const { scopedDb } = await import("../../scoped-db");
    const scope = scopedDb(rlsDb, org.orgId);
    const rows = await scope.run((s) => s.findMany("items"));
    expect(rows.map((r) => r.id)).toEqual([item.itemId]);

    await truncateAll();
  });
});
