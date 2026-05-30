/**
 * Keyset (cursor) pagination shared across the high-cardinality list endpoints
 * (items, agents, permissions). Pages are ordered by `(createdAt DESC, id DESC)`
 * — an immutable tuple, so a row inserted concurrently never shifts an existing
 * page (stable, non-overlapping). Callers that omit `cursor`/`limit` get the
 * first page (up to DEFAULT_PAGE_LIMIT) and can ignore `nextCursor`.
 *
 * The cursor encodes the timestamp at MICROSECOND precision, not as an ISO-8601
 * string: Postgres `timestamptz` stores microseconds but `Date.toISOString()`
 * only has millisecond resolution, so a batch writing more than MAX_PAGE_LIMIT
 * rows in one transaction (identical `created_at`) would leave every row beyond
 * the first page unreachable. The cursor instead carries
 * `(EXTRACT(EPOCH FROM created_at) * 1000000)::bigint` (microseconds since Unix
 * epoch). The identical expression appears in both the SELECT projection and the
 * WHERE predicate, so the comparison is value-identical for the same stored
 * timestamp regardless of intermediate float rounding. JS `Number` represents
 * all current-era microsecond epoch values exactly (< 2^53). A malformed cursor
 * decodes as `null` and fails safe to the first page.
 */

import { and, type Column, lt, or, type SQL, sql } from "@abadge/db";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/** Clamp a caller-supplied limit into [1, MAX_PAGE_LIMIT]; default when absent. */
export function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE_LIMIT);
}

/**
 * Microsecond-epoch SQL expression for a `timestamptz` column.
 * Returns the column value as an integer count of microseconds since the Unix
 * epoch, cast to Postgres `bigint`. Postgres-js materialises bigint columns as
 * decimal strings, so the TypeScript type is `string`.
 *
 * Must be used consistently in both SELECT projections and WHERE predicates so
 * that cursor values and comparison values are computed by the same expression.
 */
export function epochMicros(col: Column): SQL<string> {
  return sql<string>`(EXTRACT(EPOCH FROM ${col}) * 1000000)::bigint`;
}

export interface DecodedCursor {
  /** Microseconds since Unix epoch, as a decimal string (Postgres bigint wire format). */
  createdAtUs: string;
  id: string;
}

/**
 * Keyset predicate for a `(createdAt DESC, id DESC)` ordering: rows strictly
 * after the cursor. Returns `undefined` for a null cursor so it can be dropped
 * straight into an `and(...)` clause as a no-op (first page).
 *
 * Uses `epochMicros(col)` rather than the raw column so microsecond precision
 * is preserved when the stored timestamp has sub-millisecond components.
 */
export function cursorCondition(
  createdAtColumn: Column,
  idColumn: Column,
  cursor: DecodedCursor | null,
): SQL | undefined {
  if (!cursor) return undefined;
  const us = epochMicros(createdAtColumn);
  // cursor.createdAtUs is a validated decimal string; ::bigint cast makes
  // Postgres interpret it as an integer for an exact comparison.
  return or(
    sql`${us} < ${cursor.createdAtUs}::bigint`,
    and(sql`${us} = ${cursor.createdAtUs}::bigint`, lt(idColumn, cursor.id)),
  );
}

// Opaque base64url over `${createdAtUs}|${id}` where createdAtUs is a decimal
// bigint string (microseconds since Unix epoch). btoa/atob are available in
// both the Workers runtime and Bun; the payload is ASCII.
function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeCursor(createdAtUs: string, id: string): string {
  return toBase64Url(`${createdAtUs}|${id}`);
}

/** Decode a cursor; returns null for missing or malformed input (fail-safe to first page). */
export function decodeCursor(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) return null;
  try {
    const decoded = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const sep = decoded.indexOf("|");
    if (sep === -1) return null;
    const createdAtUs = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    // Validate: createdAtUs must be a non-empty decimal integer string.
    if (!/^\d+$/.test(createdAtUs) || id.length === 0) return null;
    return { createdAtUs, id };
  } catch {
    return null;
  }
}

/**
 * nextCursor for a fetched page: null when the page is the last (fewer rows
 * than the limit), otherwise the cursor of the final row.
 *
 * Rows must include `createdAtUs` — the microsecond epoch value selected via
 * `epochMicros(col)`. The DB returns bigint columns as decimal strings, so the
 * expected type is `string`.
 */
export function nextCursorFrom(
  rows: ReadonlyArray<{ createdAtUs: string; id: string }>,
  limit: number,
): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return last ? encodeCursor(last.createdAtUs, last.id) : null;
}
