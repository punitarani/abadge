import type { MiddlewareHandler } from "hono";

/**
 * Marks secret-bearing responses uncacheable with `Cache-Control: no-store` +
 * `Pragma: no-cache`. Such responses can carry plaintext, ciphertext, session
 * tokens, or mount payloads; without `no-store` a browser, proxy, or service
 * worker could persist a secret to a shared cache. The headers are set in a
 * `finally` so they override any handler-set Cache-Control and still apply when
 * a handler throws and `app.onError` produces the response.
 */
export const noStore: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } finally {
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    c.header("Pragma", "no-cache");
  }
};
