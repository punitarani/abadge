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
    // ON ALL TABLES is a snapshot grant; ALTER DEFAULT PRIVILEGES keeps the role
    // covered for tables added by later migrations as the schema evolves.
    await db.execute(
      sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${sql.raw(RLS_ROLE)}`,
    );
    rlsDb = createDb(rlsRoleUrl());
  });

  afterAll(async () => {
    try {
      await db.execute(
        sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${sql.raw(RLS_ROLE)}`,
      );
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

  test("WITH CHECK blocks writes whose organization_id mismatches the org context", async () => {
    const userA = await seedUser(auth);
    const orgA = await seedOrg(auth, userA.userId);
    const itemA = await seedServerItem(db, { userId: userA.userId, orgId: orgA.orgId, label: "a" });

    // A write that lands a row in another org fails the WITH CHECK clause and aborts.
    await expect(
      rlsDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org', ${orgA.orgId}, true)`);
        await tx.execute(
          sql`insert into items (id, organization_id, label, storage_mode)
              values (${crypto.randomUUID()}, 'org-elsewhere', 'leak', 'server_managed')`,
        );
      }),
    ).rejects.toThrow();

    // Moving an existing row out of the org context fails WITH CHECK too.
    await expect(
      rlsDb.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.current_org', ${orgA.orgId}, true)`);
        await tx.execute(
          sql`update items set organization_id = 'org-elsewhere' where id = ${itemA.itemId}`,
        );
      }),
    ).rejects.toThrow();

    // A write that stays within the org context passes WITH CHECK and commits.
    const newId = crypto.randomUUID();
    const committed = await rlsDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${orgA.orgId}, true)`);
      await tx.execute(
        sql`insert into items (id, organization_id, label, storage_mode)
            values (${newId}, ${orgA.orgId}, 'scoped-ok', 'server_managed')`,
      );
      return tx.select({ id: items.id }).from(items).where(eq(items.id, newId));
    });
    expect(committed.map((r) => r.id)).toEqual([newId]);

    await truncateAll();
  });

  test("a bare non-transactional query fails closed — SET LOCAL never applied (AC3)", async () => {
    // Seed a live row so we know there is data to leak if RLS failed open.
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);
    await seedServerItem(db, { userId: user.userId, orgId: org.orgId, label: "ac3" });

    // SET LOCAL is transaction-scoped. A bare SELECT outside any explicit tx runs
    // in its own implicit autocommit transaction where the GUC was never set.
    // current_setting('app.current_org', true) returns NULL → NULL = NULL is never
    // TRUE → zero rows, never an unfiltered leak.
    const bare = await rlsDb.select({ id: items.id }).from(items);
    expect(bare).toEqual([]);

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
