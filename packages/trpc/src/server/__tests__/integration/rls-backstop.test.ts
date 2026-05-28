import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb, type Database, eq, sql } from "@abadge/db";
import { items, permissions } from "@abadge/db/schema";
import {
  seedAgent,
  seedAgentSession,
  seedOrg,
  seedPermission,
  seedServerItem,
  seedUser,
} from "../helpers/seed";
import { createTestAuth } from "../helpers/test-auth";
import { createAgentCaller, createOperatorCaller } from "../helpers/test-callers";
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
    // Sequence USAGE so the role can INSERT into serial-id tables (e.g. audit_logs
    // via audit_logs_id_seq). Mirrors what migration 0022_least_privilege_role
    // grants the production `app_runtime` role; without it, any procedure that
    // writes an audit row fails with "permission denied for sequence".
    await db.execute(
      sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${sql.raw(RLS_ROLE)}`,
    );
    await db.execute(
      sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${sql.raw(RLS_ROLE)}`,
    );
    rlsDb = createDb(rlsRoleUrl());
  });

  afterAll(async () => {
    try {
      await db.execute(
        sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${sql.raw(RLS_ROLE)}`,
      );
      await db.execute(
        sql`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM ${sql.raw(RLS_ROLE)}`,
      );
      await db.execute(sql`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${sql.raw(RLS_ROLE)}`);
      await db.execute(sql`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${sql.raw(RLS_ROLE)}`);
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

  // ---------------------------------------------------------------------------
  // §AB-0011 activation — real tRPC procedures driven over the NOBYPASSRLS role.
  //
  // The default integration role is a superuser that BYPASSES RLS, so these are
  // the ONLY tests that prove the request-path GUC wiring (the init.ts middleware
  // plus the organizations/profiles/auth edge cases) actually works end to end.
  // Seeding uses the superuser `db` (RLS-bypassing, so state always lands); the
  // caller's `ctx.db` is `rlsDb`, so the procedures themselves run as the
  // restricted role and are subject to RLS.
  // ---------------------------------------------------------------------------

  test("nested savepoint inherits the org GUC; the GUC does not bleed across transactions", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);
    const item = await seedServerItem(db, { userId: user.userId, orgId: org.orgId, label: "sp" });

    // A nested tx() (savepoint) under a GUC-set outer tx sees the org's rows — the
    // property the request-path middleware relies on so cascade deletes (which run
    // as a savepoint of the request transaction) inherit the org context.
    const seenInSavepoint = await rlsDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org', ${org.orgId}, true)`);
      return tx.transaction((inner) => inner.select({ id: items.id }).from(items));
    });
    expect(seenInSavepoint.map((r) => r.id)).toEqual([item.itemId]);

    // A fresh transaction with no GUC sees nothing — per-transaction locality
    // holds under the max:1 pool, so the GUC never bleeds from a prior request.
    const seenFresh = await rlsDb.transaction((tx) => tx.select({ id: items.id }).from(items));
    expect(seenFresh).toEqual([]);

    await truncateAll();
  });

  test("scopedSessionProcedure: items.list returns the org's rows under the restricted role", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);
    const item = await seedServerItem(db, { userId: user.userId, orgId: org.orgId, label: "live" });

    const operator = createOperatorCaller(rlsDb, auth, user.headers, org.orgId);
    const res = await operator.items.list({});
    expect(res.items.some((i: { id: string }) => i.id === item.itemId)).toBe(true);

    await truncateAll();
  });

  test("agentProcedure: access.read authenticates (agents RLS-exempt) and decrypts under the restricted role", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);
    const item = await seedServerItem(db, {
      userId: user.userId,
      orgId: org.orgId,
      fields: { username: "admin", password: "s3cret" },
    });
    const agent = await seedAgent(db, { userId: user.userId, orgId: org.orgId, kind: "local_cli" });
    const session = await seedAgentSession(db, { agentId: agent.agentId, userId: user.userId });
    await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: user.userId,
    });

    // Agent auth reads agentSessions (not RLS) then agents (RLS-exempt, 0022)
    // pre-org; the agentProcedure then sets the org GUC for the access pipeline.
    const agentCaller = createAgentCaller(rlsDb, auth, session.rawToken);
    const res = await agentCaller.access.read({ itemId: item.itemId });
    if (res.storageMode !== "server_managed") throw new Error("expected server_managed payload");
    expect(res.payload.fields.password).toBe("s3cret");

    await truncateAll();
  });

  test("cross-org isolation holds through real procedures under the restricted role", async () => {
    const userA = await seedUser(auth);
    const orgA = await seedOrg(auth, userA.userId);
    const userB = await seedUser(auth);
    const orgB = await seedOrg(auth, userB.userId);
    const itemB = await seedServerItem(db, {
      userId: userB.userId,
      orgId: orgB.orgId,
      label: "b-secret",
    });

    const operatorA = createOperatorCaller(rlsDb, auth, userA.headers, orgA.orgId);
    // org A's caller cannot fetch org B's item by id...
    await expect(operatorA.items.get({ itemId: itemB.itemId })).rejects.toThrow();
    // ...and it never appears in the list.
    const list = await operatorA.items.list({});
    expect(list.items.some((i: { id: string }) => i.id === itemB.itemId)).toBe(false);

    await truncateAll();
  });

  test("cascade integrity: items.delete deletes the item's permissions under the restricted role", async () => {
    const user = await seedUser(auth);
    const org = await seedOrg(auth, user.userId);
    const item = await seedServerItem(db, { userId: user.userId, orgId: org.orgId });
    const agent = await seedAgent(db, { userId: user.userId, orgId: org.orgId, kind: "local_cli" });
    const perm = await seedPermission(db, {
      orgId: org.orgId,
      agentId: agent.agentId,
      itemId: item.itemId,
      capability: "reveal_plaintext",
      grantedBy: user.userId,
    });

    const operator = createOperatorCaller(rlsDb, auth, user.headers, org.orgId);
    await operator.items.delete({ itemId: item.itemId });

    // Read back as the superuser: the cascade (onItemDeleted, a savepoint under the
    // request's org-GUC transaction) must have deleted the grant. Without the GUC
    // wiring the delete would match zero permission rows and the grant would
    // survive the item deletion — a security regression.
    const remaining = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.id, perm.permissionId));
    expect(remaining).toEqual([]);

    await truncateAll();
  });

  test("organizations.list reports each org's bootstrap state for a multi-org user (per-org GUC)", async () => {
    const user = await seedUser(auth);
    const orgA = await seedOrg(auth, user.userId); // each seeds a default server_managed profile
    const orgB = await seedOrg(auth, user.userId);

    const operator = createOperatorCaller(rlsDb, auth, user.headers);
    const res = await operator.organizations.list();
    const orgs = res.organizations as Array<{ id: string; hasBootstrappedProfile: boolean }>;
    const byId = new Map(orgs.map((o) => [o.id, o]));
    // A naive single-org GUC would let at most one org report bootstrapped; the
    // per-org loop must report both.
    expect(byId.get(orgA.orgId)?.hasBootstrappedProfile).toBe(true);
    expect(byId.get(orgB.orgId)?.hasBootstrappedProfile).toBe(true);

    await truncateAll();
  });
});
