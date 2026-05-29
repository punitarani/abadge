import { hashApiKey } from "@abadge/crypto/shared";
import type { Context } from "hono";
import type { RateLimitKeyFn } from "./rate-limit";

/**
 * Per-account rate-limit key: throttle auth attempts by the account `email` in
 * the request body, not just by IP. The per-IP limiter cannot catch a
 * distributed credential-stuffing attack (many rotating IPs against one
 * account, each staying under the per-IP cap); a per-email bucket does.
 *
 * Reading the body safely is the crux: Better Auth's handler reads
 * `c.req.raw.json()` directly, so the request body must stay intact for it.
 * We read a `clone()` (which tees the stream) and NEVER call `c.req.json()`
 * (that would consume/lock the original `raw.body` Better Auth needs). The
 * global 1MB body limit bounds the clone.
 *
 * The email is normalized (`trim().toLowerCase()`) before hashing because
 * Better Auth resolves accounts case-insensitively — without this,
 * `Victim@x.com` and `victim@x.com` hit different buckets and trivially bypass
 * the throttle. It is SHA-256 hashed so no raw address lands in a DO name or
 * log line.
 *
 * Fail-open: any missing / non-string / empty email, or a non-JSON body,
 * returns `null` → the throttle is skipped (the per-IP limiter still applies).
 */
export function accountEmailKey(prefix: string): RateLimitKeyFn {
  return async (c: Context): Promise<string | null> => {
    const body = (await c.req.raw
      .clone()
      .json()
      .catch(() => null)) as { email?: unknown } | null;
    const email = body?.email;
    if (typeof email !== "string") {
      return null;
    }
    const normalized = email.trim().toLowerCase();
    if (normalized.length === 0) {
      return null;
    }
    return `${prefix}:${await hashApiKey(normalized)}`;
  };
}
