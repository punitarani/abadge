# Runbook: least-privilege application DB role (AB-0012)

The application runtime must connect as a non-owner role with the minimum
privileges it needs. This bounds the blast radius of a compromised app worker
and is the role-level half of the audit append-only guarantee (the
[`0018` trigger](../../packages/db/migrations/0018_audit_logs_append_only.sql)
is the other half).

## Roles

| Role | rolsuper | Used by | Privileges |
|------|----------|---------|------------|
| owner (existing) | depends on host | migrations / schema management | full DDL + DML |
| `app_runtime` | **false** | application runtime (API worker via Hyperdrive) | DML only; **no UPDATE/DELETE/TRUNCATE on `audit_logs`** |

`app_runtime` is `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`. `NOBYPASSRLS`
is load-bearing: a `BYPASSRLS` role would defeat both the audit trigger and any
future row-level security.

## Why TRUNCATE matters

The `0018` trigger rejects `UPDATE`/`DELETE` for *any* role, but **`TRUNCATE`
bypasses row-level triggers**. Revoking `TRUNCATE` from `app_runtime` is the only
control that stops the app role from wiping the audit trail wholesale.

## Provisioning

Apply [`scripts/least-privilege.sql`](../../scripts/least-privilege.sql)
as the database owner. On PlanetScale, run it from the console / a privileged
psql session (role management is not a Drizzle migration — migrations run as the
owner and must not depend on the app role existing). Substitute your branch's
actual database name for `abadge` in the `GRANT CONNECT` statement if it differs.

```bash
psql "$OWNER_DATABASE_URL" -f scripts/least-privilege.sql
```

## Cutover

> [!WARNING]
> **Do not cut over to `app_runtime` yet.** Migration `0021_rls_backstop` FORCE-enables
> row-level security keyed on the `app.current_org` GUC, but no application read path
> sets that GUC today (`scopedDb.run()` exists but is not yet wired into the routers),
> and agent authentication reads the `agents` table before any org context exists.
> Connecting the app as the `NOBYPASSRLS` `app_runtime` role before that wiring lands
> would fail closed: every tenant read returns zero rows (blank dashboard) and agent
> auth fails (every agent request 401s) — a silent, total outage. Provisioning the role
> now (the steps above) is safe; perform the cutover below only once the RLS GUC wiring
> (request-path `set_config('app.current_org', …)` + an `agents` RLS reconciliation) has
> shipped and is covered by a restricted-role integration test.

1. Provision `app_runtime` (above) and set its password / connection secret.
2. Point the **application** connection at `app_runtime`: update the API worker's
   `DATABASE_URL` (the Hyperdrive binding's origin connection string) to use the
   `app_runtime` credentials. Leave the **migration** job pointed at the owner.
3. Redeploy the worker. The migration pipeline keeps using the owner role.

> [!CAUTION]
> **Confirm the deploy actually landed before cutting over.** CI runs `db-migrate`
> **before** `deploy-api`, and both are gated behind a green `main`. If `main` is
> red (e.g. a failing integration test), neither the migration nor the worker
> deploy runs, so the DB and the worker silently drift. The GUC-wiring code
> (`init.ts` request middleware + `seedOrgWithOwnerProfile`) must be **live in the
> deployed worker** before the connection points at the `NOBYPASSRLS` role —
> otherwise FORCE-RLS rejects every tenant-table write (`WITH CHECK`) and surfaces
> as `INTERNAL_SERVER_ERROR` (e.g. `organizations.create` / `createPersonal`),
> while auth keeps working because Better Auth tables are not under RLS. Order:
> (1) merge + **verify the deploy completed**, (2) only then cut over. Coverage for
> the org/profile-creation write path under the restricted role lives in
> `rls-backstop.test.ts` ("under the restricted role" cases).

## Verify

```sql
-- 1. The app role is not privileged.
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_runtime';
-- expected: f | f

-- 2. Append-only on audit_logs, full DML elsewhere.
SELECT has_table_privilege('app_runtime', 'audit_logs', 'INSERT'),  -- t
       has_table_privilege('app_runtime', 'audit_logs', 'UPDATE'),  -- f
       has_table_privilege('app_runtime', 'audit_logs', 'DELETE'),  -- f
       has_table_privilege('app_runtime', 'audit_logs', 'TRUNCATE'),-- f
       has_table_privilege('app_runtime', 'items', 'UPDATE');       -- t
```

The automated equivalent of these checks runs in
`packages/trpc/src/server/__tests__/integration/least-privilege-role.test.ts`
(against an ephemeral role with the same policy).

## statement_timeout (AB — runaway-query guard)

`app_runtime` carries a `statement_timeout = '15s'` role default, set by
[`0028_app_runtime_statement_timeout.sql`](../../packages/db/migrations/0028_app_runtime_statement_timeout.sql).
The connection pool — not query latency — is the throughput wall (PS-10 ~25
connections, Hyperdrive holds a small active pool), so a single query stuck far
beyond the sub-second norm would starve every other request sharing the pool.
15s is ~100x the slowest observed legit statement and only cancels a genuinely
runaway query (canceled queries raise SQLSTATE `57014`, which the API maps to a
retryable `503`).

It is set as a **role default** — not the postgres-js `connection: { … }` param
— because Hyperdrive's transaction pooler `RESET`s driver-set session GUCs when
a connection returns to the pool. A role default survives `RESET` (which
restores the role's configured defaults). See `hyperdrive-resets-session-state`.

> [!IMPORTANT]
> This bounds queries **only for connections made as `app_runtime`**. Until the
> cutover above happens (app still connecting as the owner), it is a harmless
> no-op for the live runtime — and it is deliberately NOT set on the owner,
> whose migrations + roadmap backfill can legitimately run longer than 15s.

**Verify (post-cutover, through Hyperdrive — a direct psql/`:5433` check is
insufficient because Hyperdrive could drop a driver GUC and the role default
would still show locally):**

```sql
-- Role default is set (any connection, incl. owner):
SELECT rolconfig FROM pg_roles WHERE rolname = 'app_runtime';
-- expected to contain: statement_timeout=15s

-- Effective on a real app_runtime connection THROUGH HYPERDRIVE (run via the
-- deployed worker, not a direct psql session):
SHOW statement_timeout;  -- expected: 15s
```

## Rollback

Repoint the application connection back at the owner role and redeploy. The
trigger continues to enforce row-level audit immutability regardless of which
role the app uses, so audit integrity is preserved during rollback.
