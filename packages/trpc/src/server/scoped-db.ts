import type { Database, Transaction } from "@abadge/db";
import { and, eq, type SQL } from "@abadge/db";
import { agents, auditLogs, items, permissions, profiles } from "@abadge/db/schema";

/**
 * §AB-0010 — Org-scoped data-access layer.
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
 * `run()` is transaction-oriented: the AB-0011 RLS backstop prepends
 * `SET LOCAL app.current_org` as the first statement of every scoped tx, so a
 * scoped read executed outside a transaction fails closed rather than running
 * unfiltered under Hyperdrive's connection pooling.
 */

const TENANT_TABLES = { items, profiles, agents, permissions, auditLogs } as const;

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
  /** Run `fn` inside a transaction with a tx-bound scope (AB-0011 SET LOCAL hook). */
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
      return executor.transaction((tx) => fn(scopedDb(tx, orgId)));
    },
  };

  return scoped;
}
