/**
 * §AB-0050 — keyset (cursor) pagination shared across the high-cardinality
 * list endpoints (items, agents, permissions). Pages are ordered by
 * `(createdAt DESC, id DESC)` — an immutable tuple, so a row inserted
 * concurrently never shifts an existing page (stable, non-overlapping).
 *
 * Backward compatible: callers that ignore `cursor`/`limit` get the first page
 * (up to DEFAULT_PAGE_LIMIT) and can ignore `nextCursor`; the existing array
 * key on each result is unchanged.
 */

import { and, type Column, eq, lt, or, type SQL } from "@abadge/db";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

/** Clamp a caller-supplied limit into [1, MAX_PAGE_LIMIT]; default when absent. */
export function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_PAGE_LIMIT);
}

export interface DecodedCursor {
  createdAt: Date;
  id: string;
}

/**
 * Keyset predicate for a `(createdAt DESC, id DESC)` ordering: rows strictly
 * after the cursor. Returns `undefined` for a null cursor so it can be dropped
 * straight into an `and(...)` clause as a no-op (first page).
 */
export function cursorCondition(
  createdAtColumn: Column,
  idColumn: Column,
  cursor: DecodedCursor | null,
): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(createdAtColumn, cursor.createdAt),
    and(eq(createdAtColumn, cursor.createdAt), lt(idColumn, cursor.id)),
  );
}

// Opaque base64url over `${isoCreatedAt}|${id}`. btoa/atob are available in
// both the Workers runtime and Bun; the payload is ASCII (ISO date + id).
function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function encodeCursor(createdAt: Date, id: string): string {
  return toBase64Url(`${createdAt.toISOString()}|${id}`);
}

/** Decode a cursor; returns null for missing or malformed input (fail-safe to first page). */
export function decodeCursor(cursor: string | undefined): DecodedCursor | null {
  if (!cursor) return null;
  try {
    const decoded = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const sep = decoded.indexOf("|");
    if (sep === -1) return null;
    const createdAt = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * nextCursor for a fetched page: null when the page is the last (fewer rows
 * than the limit), otherwise the cursor of the final row.
 */
export function nextCursorFrom(
  rows: ReadonlyArray<{ createdAt: Date; id: string }>,
  limit: number,
): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return last ? encodeCursor(last.createdAt, last.id) : null;
}
