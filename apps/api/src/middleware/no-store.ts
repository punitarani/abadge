import type { MiddlewareHandler } from "hono";

/**
 * §AB-0051 — mark responses on secret-bearing surfaces uncacheable.
 *
 * The tRPC (`/trpc/*`), REST (`/v1/*`), and Better Auth (`/api/auth/*`)
 * surfaces can all carry plaintext, ciphertext, session tokens, or mount
 * payloads (e.g. access.read/use/redeemMount, items.ownerReveal, auth session
 * exchange). A secret-bearing response without `no-store` can be persisted by a
 * browser, intermediary proxy, or service worker — a concrete exfiltration
 * vector. Set unconditionally on these prefixes because for an operator/agent
 * API the lost caching benefit is negligible. Runs after the handler so it
 * overrides any handler-set Cache-Control.
 */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store, no-cache, must-revalidate");
  c.header("Pragma", "no-cache");
};
