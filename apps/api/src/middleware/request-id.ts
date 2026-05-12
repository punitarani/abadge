import type { MiddlewareHandler } from "hono";

/**
 * X-Request-Id propagation middleware (§REVAMP-PR3).
 *
 * Echo a caller-provided ID if it looks reasonable; otherwise mint a fresh
 * `req_<uuid>`. The id is stashed on the Hono context as `c.var.requestId`
 * for downstream handlers (REST adapter, audit log meta, error envelopes)
 * and echoed on the response so clients can correlate logs.
 *
 * Pattern intentionally narrow: alphanumerics, dash, underscore, 6–64
 * chars. Anything else is dropped silently to avoid header injection /
 * log poisoning. The minted form (`req_<uuid v4>`) is always 40 chars
 * within the allow-list.
 */
export const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;

export const requestId: MiddlewareHandler<{
  Variables: { requestId: string };
}> = async (c, next) => {
  const incoming = c.req.header("X-Request-Id");
  const id =
    incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : `req_${crypto.randomUUID()}`;
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  await next();
};
