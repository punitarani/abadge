/**
 * RateLimitCounter — cross-isolate consistent fixed-window counter.
 *
 * One DO instance per `path:ip` key (via `idFromName`), so different paths
 * and client IPs never contaminate each other's buckets. State lives in DO
 * storage (SQLite-backed, single-byte-scale per key), so every isolate
 * observes the same counter value — a module-level `Map` would count
 * independently per isolate (under-counting) and grow without bound.
 *
 * This is the documented exception to the "No Durable Objects" invariant:
 * rate-limit correctness requires a counter consistent across isolates, and
 * no primitive simpler than a DO provides that on Workers.
 */
export interface RateLimitCheckResult {
  /** True when count <= limit (request is allowed). */
  readonly ok: boolean;
  /** Request count within the current window (including this request). */
  readonly count: number;
  /** Configured per-window limit. */
  readonly limit: number;
  /** ms epoch when the current window ends. */
  readonly resetAt: number;
  /** Seconds until reset; 0 when `ok` is true. */
  readonly retryAfter: number;
}

type StoredBucket = { count: number; resetAt: number };

type MinimalState = Pick<DurableObjectState, "storage">;

/**
 * Anything we read from the request body. Middleware controls this shape —
 * DO is internal and never exposed.
 */
interface CheckRequest {
  limit: number;
  windowMs: number;
}

export class RateLimitCounter {
  private readonly state: MinimalState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/check" || request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    const body = (await request.json()) as CheckRequest;
    const now = Date.now();

    const stored = (await this.state.storage.get<StoredBucket>("bucket")) ?? {
      count: 0,
      resetAt: 0,
    };

    let count: number;
    let resetAt: number;
    if (now >= stored.resetAt) {
      // New window — start fresh.
      count = 1;
      resetAt = now + body.windowMs;
    } else {
      count = stored.count + 1;
      resetAt = stored.resetAt;
    }

    await this.state.storage.put<StoredBucket>("bucket", { count, resetAt });

    const ok = count <= body.limit;
    const retryAfter = ok ? 0 : Math.max(0, Math.ceil((resetAt - now) / 1000));

    const result: RateLimitCheckResult = {
      ok,
      count,
      limit: body.limit,
      resetAt,
      retryAfter,
    };
    return Response.json(result);
  }
}
