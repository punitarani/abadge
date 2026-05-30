import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { RateLimitCheckResult } from "../durable-objects/rate-limit-counter";

type RateLimitBindings = {
  RATE_LIMIT: DurableObjectNamespace;
  NODE_ENV?: string;
};

/**
 * Optional bucket-key strategy. Returning `null` skips the throttle for this
 * request (fail-open) — e.g. the per-account key fn returns `null` when the
 * body carries no email. When omitted, the key is the default `path:ip` and
 * behavior is identical to the IP-only limiter.
 */
export type RateLimitKeyFn = (
  c: Context<{ Bindings: RateLimitBindings }>,
) => Promise<string | null> | string | null;

/**
 * Hono middleware backed by the `RateLimitCounter` Durable Object.
 *
 * Design guarantees:
 *   - 429 responses use the canonical `{code,message,hint,meta}` envelope.
 *   - `Retry-After` + `X-RateLimit-{Limit,Remaining,Reset}` accompany every
 *     response per RFC 6585 §4, so clients can back off before being blocked.
 *   - Caller identity comes only from headers the client cannot spoof; see
 *     `resolveClientIp`.
 *   - Counter state lives in the Durable Object, not a module-level `Map`, so
 *     it stays consistent across isolates and is auto-evicted on inactivity.
 *   - Bucket keys are `path:ip`, so `/api/auth` and `/trpc` traffic share no
 *     counter while requests within one surface do; see `normalizePath`.
 */
export function rateLimitMiddleware(limit: number, windowMs: number, keyFn?: RateLimitKeyFn) {
  return createMiddleware<{ Bindings: RateLimitBindings }>(async (c, next) => {
    const key = keyFn
      ? await keyFn(c)
      : `${normalizePath(c.req.path)}:${resolveClientIp(c.req.raw, c.env)}`;
    // Fail-open: a `null` key means this throttle does not apply to this
    // request (e.g. the per-account key fn found no email in the body) — fall
    // through so other middleware (the per-IP limiter) still runs.
    if (key === null) {
      await next();
      return;
    }

    const id = c.env.RATE_LIMIT.idFromName(key);
    const stub = c.env.RATE_LIMIT.get(id);

    const res = await stub.fetch("https://rate-limit.internal/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit, windowMs }),
    });
    const result = (await res.json()) as RateLimitCheckResult;

    // RFC 6585 / IETF draft `X-RateLimit` headers — set on every response,
    // not just 429s, so well-behaved clients can back off before they hit
    // the limit.
    c.header("X-RateLimit-Limit", String(result.limit));
    c.header("X-RateLimit-Remaining", String(Math.max(0, result.limit - result.count)));
    c.header("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));

    if (!result.ok) {
      c.header("Retry-After", String(result.retryAfter));
      return c.json(
        {
          code: "RATE_LIMITED",
          message: `Rate limit exceeded (${result.limit} requests per ${Math.round(windowMs / 1000)}s)`,
          hint: `Wait ${result.retryAfter} seconds and retry.`,
          meta: {
            retryAfter: result.retryAfter,
            limit: result.limit,
            resetAt: result.resetAt,
          },
        },
        429,
      );
    }

    await next();
  });
}

/**
 * Identify the caller without trusting spoofable headers.
 *
 *  - In production (behind the CF edge, enforced by `NODE_ENV`) the
 *    `cf-connecting-ip` header is authoritative.
 *  - `X-Forwarded-For` is never consulted — it is writable by the client in
 *    any deployment not strictly behind CF.
 *  - Anywhere else we fall back to request-bound identifiers the client
 *    cannot freely rewrite (`cf.clientIp`, `cf-ray`, `x-request-id`) and
 *    finally a path-segment synthetic. Never a shared "unknown" bucket.
 */
function resolveClientIp(req: Request, env: { NODE_ENV?: string }): string {
  const isProd = env.NODE_ENV === "production";
  if (isProd) {
    const cfIp = req.headers.get("cf-connecting-ip");
    if (cfIp) return cfIp;
  }

  const cfClientIp = (req as Request & { cf?: { clientIp?: string } }).cf?.clientIp;
  if (cfClientIp) return cfClientIp;

  const reqId = req.headers.get("cf-ray") ?? req.headers.get("x-request-id");
  if (reqId) return `req:${reqId.slice(0, 16)}`;

  // Dev/non-CF last resort: salt by path so `/health` and `/trpc` don't
  // collapse into the same bucket even when the rest of the identifier
  // hierarchy is empty.
  return `dev:${new URL(req.url).pathname.split("/").slice(0, 3).join("/")}`;
}

/**
 * Coarse bucket prefix so `/trpc/items.list` and `/trpc/items.create` share
 * a counter while still isolating `/trpc` from `/api/auth`.
 */
function normalizePath(path: string): string {
  if (path.startsWith("/trpc/")) return "/trpc";
  if (path.startsWith("/api/auth/")) return "/api/auth";
  if (path.startsWith("/api/v1/")) return "/api/v1";
  // Bucket bare /agent/auth with its sub-paths so the claim ceremony shares one
  // counter and stays isolated from any future /agent/* surface.
  if (path === "/agent/auth" || path.startsWith("/agent/auth/")) return "/agent/auth";
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? `/${segments[0]}` : "/";
}
