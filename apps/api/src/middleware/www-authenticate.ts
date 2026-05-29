import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../types";

/**
 * RFC 9728 bootstrap: on any 401, advertise where an agent can discover the
 * auth.md registration flow. Agents that hit a protected route without a (valid)
 * credential read this header and follow it to Protected Resource Metadata —
 * no out-of-band docs needed. Set in a `finally` so it also applies to 401s
 * produced by `app.onError`.
 */
export const wwwAuthenticate: MiddlewareHandler<{ Bindings: Bindings }> = async (c, next) => {
  try {
    await next();
  } finally {
    if (c.res.status === 401 && !c.res.headers.has("WWW-Authenticate")) {
      const base = (c.env.ABADGE_API_URL ?? "").replace(/\/$/, "");
      c.header(
        "WWW-Authenticate",
        `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      );
    }
  }
};
