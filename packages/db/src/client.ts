import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 1,
    fetch_types: false,
    prepare: false,
  });
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createDb>;

/**
 * A Drizzle transaction handle — the `tx` argument passed to the callback of
 * `db.transaction(async (tx) => { ... })`. Structurally a `PgDatabase` so it
 * supports all the same query builders, but represents state inside an open
 * transaction rather than a pooled connection.
 *
 * Extracted from the `Database["transaction"]` callback parameter so the
 * type stays in lockstep with whatever Drizzle returns — no manual
 * `PgTransaction<Hkt, Schema, ...>` duplication here.
 *
 * Helpers that must run atomically (cascades, multi-step writes) should
 * accept a `Transaction` and require the caller to own the outer
 * `ctx.db.transaction(...)` boundary. Callers that legitimately need a
 * standalone helper-scoped transaction can still write
 * `await db.transaction((tx) => helper(tx, ...))`.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
