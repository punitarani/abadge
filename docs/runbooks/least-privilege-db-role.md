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
| `abadge_app` | **false** | application runtime (API worker via Hyperdrive) | DML only; **no UPDATE/DELETE/TRUNCATE on `audit_logs`** |

`abadge_app` is `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`. `NOBYPASSRLS`
is load-bearing: a `BYPASSRLS` role would defeat both the audit trigger and any
future row-level security.

## Why TRUNCATE matters

The `0018` trigger rejects `UPDATE`/`DELETE` for *any* role, but **`TRUNCATE`
bypasses row-level triggers**. Revoking `TRUNCATE` from `abadge_app` is the only
control that stops the app role from wiping the audit trail wholesale.

## Provisioning

Apply [`packages/db/least-privilege.sql`](../../packages/db/least-privilege.sql)
as the database owner. On PlanetScale, run it from the console / a privileged
psql session (role management is not a Drizzle migration — migrations run as the
owner and must not depend on the app role existing).

```bash
psql "$OWNER_DATABASE_URL" -f packages/db/least-privilege.sql
```

## Cutover

1. Provision `abadge_app` (above) and set its password / connection secret.
2. Point the **application** connection at `abadge_app`: update the API worker's
   `DATABASE_URL` (the Hyperdrive binding's origin connection string) to use the
   `abadge_app` credentials. Leave the **migration** job pointed at the owner.
3. Redeploy the worker. The migration pipeline keeps using the owner role.

## Verify

```sql
-- 1. The app role is not privileged.
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'abadge_app';
-- expected: f | f

-- 2. Append-only on audit_logs, full DML elsewhere.
SELECT has_table_privilege('abadge_app', 'audit_logs', 'INSERT'),  -- t
       has_table_privilege('abadge_app', 'audit_logs', 'UPDATE'),  -- f
       has_table_privilege('abadge_app', 'audit_logs', 'DELETE'),  -- f
       has_table_privilege('abadge_app', 'audit_logs', 'TRUNCATE'),-- f
       has_table_privilege('abadge_app', 'items', 'UPDATE');       -- t
```

The automated equivalent of these checks runs in
`packages/trpc/src/server/__tests__/integration/least-privilege-role.test.ts`
(against an ephemeral role with the same policy).

## Rollback

Repoint the application connection back at the owner role and redeploy. The
trigger continues to enforce row-level audit immutability regardless of which
role the app uses, so audit integrity is preserved during rollback.
