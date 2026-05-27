import { createAuth, getTrustedOrigins } from "@abadge/auth";
import { validateWorkerEnv } from "@abadge/env/worker";
import { handleTrpcRequest } from "@abadge/trpc/server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import { getConnectionString, getDb } from "./lib/db";
import { authEnvelopeMiddleware } from "./middleware/auth-envelope";
import { noStore } from "./middleware/no-store";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestId } from "./middleware/request-id";
import { getOpenApiDocument } from "./rest/openapi";
import { handleV1Request } from "./rest/v1";
import type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

// Reject oversized bodies before any other middleware runs to prevent
// write-amplification DoS (§DoS2): 100 req/min × 100MB = 10 GB/min otherwise.
app.use(
  "*",
  bodyLimit({
    maxSize: 1 * 1024 * 1024, // 1 MB
    onError: (c) =>
      c.json(
        {
          code: "PAYLOAD_TOO_LARGE",
          message: "Request body exceeds the 1MB limit",
          hint: "Send smaller payloads, split data into multiple requests, or contact support if your use case needs larger payloads.",
          meta: { maxBytes: 1_048_576 },
        },
        413,
      ),
  }),
);

// Global middleware
app.use(trimTrailingSlash());
// X-Request-Id: echo a valid caller-supplied id or mint one. Runs before
// CORS/auth so every response — including 4xx/5xx — carries the header.
app.use("*", requestId);
app.use("*", secureHeaders());
app.use("*", async (c, next) =>
  cors({
    origin: getTrustedOrigins(c.env),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Abadge-Org-Id"],
    credentials: true,
  })(c, next),
);

// Rate limiting
app.use("/api/auth/*", rateLimitMiddleware(60, 60_000));
app.use("/trpc/*", rateLimitMiddleware(100, 60_000));
// `/v1/*` rate limit matches `/trpc/*` — both surfaces hit the same
// procedures via the same caller factory.
app.use("/v1/*", rateLimitMiddleware(100, 60_000));

// These prefixes carry plaintext, ciphertext, or session tokens; mark their
// responses uncacheable so no browser, proxy, or service worker can persist one.
app.use("/api/auth/*", noStore);
app.use("/trpc/*", noStore);
app.use("/v1/*", noStore);

// Wrap bare Better Auth 4xx responses into the canonical {code, message, hint, meta} envelope.
app.use("/api/auth/*", authEnvelopeMiddleware);

// Better Auth catch-all route
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const db = getDb(getConnectionString(c.env));
  // SEND_EMAIL is a CF runtime binding (not a string env var), so it cannot go
  // through validateWorkerEnv's zod schema. Merge it in after validation.
  const auth = createAuth(db, {
    ...validateWorkerEnv(c.env as unknown as Record<string, unknown>),
    SEND_EMAIL: c.env.SEND_EMAIL,
  });
  return auth.handler(c.req.raw);
});

app.all("/trpc/*", (c) => handleTrpcRequest(c.req.raw, c.env));

// Canonical REST surface. Routes are derived from the tRPC router's
// `.meta({ openapi })` annotations — see `apps/api/src/rest/v1.ts`.
// `/v1/openapi.json` must be registered BEFORE the `/v1/*` catch-all so
// the spec endpoint isn't shadowed.
app.get("/v1/openapi.json", (c) => c.json(getOpenApiDocument()));
app.all("/v1/*", (c) => handleV1Request(c));

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// §ENV2c — canonical 404 envelope for unmatched routes.
app.notFound((c) =>
  c.json(
    {
      code: "NOT_FOUND",
      message: "Route not found",
      hint: "Check the API route table at /docs for supported endpoints.",
      meta: { path: c.req.path, method: c.req.method },
    },
    404,
  ),
);

// §ENV2c — canonical envelope for unhandled errors.
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const status = err.status;
    if (status >= 500) console.error("[onError]", err);
    return c.json(
      {
        code: status === 500 ? "INTERNAL_SERVER_ERROR" : "ERROR",
        message: err.message || "Error",
        hint: null,
        meta: null,
      },
      status,
    );
  }
  console.error("[onError]", err);
  return c.json(
    {
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
      hint: null,
      meta: null,
    },
    500,
  );
});

// Cloudflare requires Durable Object classes to be exported from the
// Worker's main module so the runtime can construct instances.
export { RateLimitCounter } from "./durable-objects/rate-limit-counter";
export default app;
