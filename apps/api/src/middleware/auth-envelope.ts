import type { MiddlewareHandler } from "hono";

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Better Auth emits bare {message, code} on 4xx. abadge's envelope invariant
 * requires {code, message, hint, meta}. This middleware intercepts /api/auth/*
 * responses and re-shapes 4xx JSON bodies with the missing fields (hint: null).
 * Only touches JSON 4xx; passes 2xx and non-JSON through unchanged.
 *
 * Device-flow endpoints (/api/auth/device/*) follow RFC 8628 and emit
 * {error, error_description}. Those fields are preserved verbatim so RFC 8628
 * clients keep working, and {code, message} are also populated from them so
 * the abadge envelope contract still holds.
 */
export const authEnvelopeMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.status < 400 || c.res.status >= 500) return;
  const contentType = c.res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return;

  const body = await c.res
    .clone()
    .json()
    .catch(() => null);
  if (!body || typeof body !== "object") return;

  // Already in envelope shape — pass through.
  if ("hint" in body || "meta" in body) return;

  const source = body as Record<string, unknown>;
  const oauthError = readString(source, "error");
  const oauthDescription = readString(source, "error_description");

  // Only RFC 8628 fields are forwarded explicitly; everything else from the
  // upstream auth body is dropped to keep the response surface narrow.
  const wrapped = {
    ...(oauthError !== undefined ? { error: oauthError } : {}),
    ...(oauthDescription !== undefined ? { error_description: oauthDescription } : {}),
    code: readString(source, "code") ?? oauthError ?? "AUTH_ERROR",
    message: readString(source, "message") ?? oauthDescription ?? "Authentication error",
    hint: null,
    meta: null,
  };

  // Remove stale content-length — the re-serialized body may differ in byte count.
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");

  c.res = new Response(JSON.stringify(wrapped), {
    status: c.res.status,
    headers,
  });
};
