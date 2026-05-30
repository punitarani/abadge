import type { Database, Transaction } from "@abadge/db";
import { and, eq, type SQL, sql } from "@abadge/db";
import { agents, auditLogs, items, permissions, profiles } from "@abadge/db/schema";

/**
 * Org-scoped data-access layer.
 *
 * The five tenant tables are reached only through a `scopedDb(executor, orgId)`
 * choke-point, so a forgotten `organization_id` filter cannot leak another
 * tenant's rows:
 *
 *  - `findMany` / `findFirst` bake `organization_id = orgId` into the WHERE
 *    clause, so a scoped read cannot omit the tenant filter by construction;
 *  - `insert` auto-sets `organizationId`, so a scoped write cannot forget it;
 *  - `orgScope` / `tables` are the escape hatch for queries the helpers can't
 *    express (joins, DISTINCT, projections): the pre-built org condition is
 *    handed to the caller, but a query built straight off `executor` must AND
 *    it in by hand — the layer cannot enforce that path;
 *  - the companion CI ratchet (`scoped-db-import-ban.test.ts`) bans direct
 *    imports of these tables outside this module, so a server file cannot reach
 *    a tenant table without going through an org scope.
 *
 * The `organization_id` filters are the primary isolation control. A second,
 * defense-in-depth layer is Postgres FORCE-RLS, keyed off the per-transaction
 * GUC `app.current_org`: the request boundary opens a transaction and sets that
 * GUC before any tenant query runs (see `withOrgContext` in init.ts), and the
 * runtime connects as a NOBYPASSRLS role so the policies actually enforce. With
 * the GUC unset the policies fail closed to zero rows. `run()` is the in-DAL
 * primitive for that pattern: it opens a tx and sets the GUC as its first
 * statement. The `agents` table is RLS-exempt because agent identity must be
 * resolved pre-org-context during auth.
 */

const TENANT_TABLES = { items, profiles, agents, permissions, auditLogs } as const;

/**
 * Direct table references for code that needs to query tenant tables without
 * an org scope (e.g. pre-auth procedures in routers/auth.ts that do not have
 * an org context at the time of the query). ALL callers of these references
 * must add explicit WHERE filters; the ban on direct schema imports forces
 * this through code review rather than only through static analysis.
 */
export const tenantTables = TENANT_TABLES;

export type Executor = Database | Transaction;
export type TenantTableName = keyof typeof TENANT_TABLES;
type TenantTable<T extends TenantTableName> = (typeof TENANT_TABLES)[T];
type SelectRow<T extends TenantTableName> = TenantTable<T>["$inferSelect"];
type InsertRow<T extends TenantTableName> = TenantTable<T>["$inferInsert"];

export interface FindOptions {
  /** Extra condition AND-ed with the mandatory org scope. */
  where?: SQL;
  orderBy?: SQL | SQL[];
  limit?: number;
}

export interface ScopedDb {
  readonly orgId: string;
  /** Raw db/tx escape hatch: any query built from it must AND in `orgScope` by hand. */
  readonly executor: Executor;
  /** Tenant tables. Reference columns through here, never via a direct schema import. */
  readonly tables: typeof TENANT_TABLES;
  /** Pre-built `organization_id = orgId` condition for the named tenant table. */
  orgScope(table: TenantTableName): SQL;
  /** Select rows of `table` scoped to the org; `opts.where` is AND-ed with the org filter. */
  findMany<T extends TenantTableName>(table: T, opts?: FindOptions): Promise<SelectRow<T>[]>;
  /** Select the first org-scoped row of `table` matching `opts.where`. */
  findFirst<T extends TenantTableName>(
    table: T,
    opts?: Omit<FindOptions, "limit">,
  ): Promise<SelectRow<T> | undefined>;
  /** Insert into `table` with `organizationId` injected automatically. */
  insert<T extends TenantTableName>(
    table: T,
    values: Omit<InsertRow<T>, "organizationId">,
  ): Promise<void>;
  /** Run `fn` inside a transaction with a tx-bound scope (sets the RLS org GUC). */
  run<R>(fn: (scoped: ScopedDb) => Promise<R>): Promise<R>;
}

export function scopedDb(executor: Executor, orgId: string): ScopedDb {
  const orgScope = (table: TenantTableName): SQL => eq(TENANT_TABLES[table].organizationId, orgId);

  const findMany = async <T extends TenantTableName>(
    table: T,
    opts?: FindOptions,
  ): Promise<SelectRow<T>[]> => {
    const t = TENANT_TABLES[table];
    const where = opts?.where ? and(orgScope(table), opts.where) : orgScope(table);
    // drizzle's query-builder generics reject a generic table parameter; the runtime is
    // correct and the public SelectRow<T> contract is enforced at the return boundary.
    // biome-ignore lint/suspicious/noExplicitAny: generic DAL wrapper over drizzle's typed builder
    const base = executor.select().from(t as any);
    let q = base.where(where).$dynamic();
    if (opts?.orderBy) {
      q = q.orderBy(...(Array.isArray(opts.orderBy) ? opts.orderBy : [opts.orderBy]));
    }
    if (opts?.limit !== undefined) {
      q = q.limit(opts.limit);
    }
    return (await q) as SelectRow<T>[];
  };

  const scoped: ScopedDb = {
    orgId,
    executor,
    tables: TENANT_TABLES,
    orgScope,
    findMany,
    async findFirst(table, opts) {
      const [row] = await findMany(table, { ...opts, limit: 1 });
      return row;
    },
    async insert(table, values) {
      const t = TENANT_TABLES[table];
      // biome-ignore lint/suspicious/noExplicitAny: drizzle insert rejects a generic table param; organizationId is injected here
      await (executor.insert(t as any) as any).values({ ...values, organizationId: orgId });
    },
    run(fn) {
      return executor.transaction(async (tx) => {
        // Set the per-transaction org GUC that the RLS policies read, as the first
        // statement. set_config(_, _, true) is transaction-local (like SET LOCAL) so
        // it survives connection pooling (Hyperdrive RESETs between txns, so a
        // non-transaction-local SET would not hold). Unset => RLS fails closed (zero
        // rows). No-op for superuser/BYPASSRLS connections.
        await tx.execute(sql`select set_config('app.current_org', ${orgId}, true)`);
        return fn(scopedDb(tx, orgId));
      });
    },
  };

  return scoped;
}
