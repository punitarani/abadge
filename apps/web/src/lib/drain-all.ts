/**
 * Per-request page size a drainer asks for — the server's `MAX_PAGE_LIMIT`.
 * Requesting the ceiling minimises round-trips; asking for more is rejected by
 * input validation, not clamped.
 */
export const DRAIN_PAGE_SIZE = 100;

/**
 * Pure runaway-loop guard. A `nextCursor` that never resolves to `null` means a
 * server-side cursor bug; an unbounded loop in the browser is worse than a loud
 * failure. 1000 pages × the 100-row ceiling is far above any realistic org.
 */
const MAX_DRAIN_PAGES = 1000;

/**
 * Follow `nextCursor` across every page and return the concatenation. The
 * dashboard does client-side search, filtering, and cross-list joins, all of
 * which assume the *whole* org dataset; the server caps each request at one
 * page, so the list views must drain to stay correct for orgs larger than that.
 *
 * Transport-agnostic and client-free on purpose: both the browser-client
 * wrappers and the (stub-injected, unit-tested) prefetch planner share it.
 */
export async function drainAll<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ rows: readonly T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_DRAIN_PAGES; page++) {
    const { rows, nextCursor } = await fetchPage(cursor);
    all.push(...rows);
    if (!nextCursor) return all;
    cursor = nextCursor;
  }
  throw new Error(`abadge: list pagination did not terminate after ${MAX_DRAIN_PAGES} pages`);
}
