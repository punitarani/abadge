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
import { rateLimitMiddleware } from "./middleware/rate-limit";
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

// Wrap bare Better Auth 4xx responses into the canonical {code, message, hint, meta} envelope.
app.use("/api/auth/*", authEnvelopeMiddleware);

// Better Auth catch-all route
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const db = getDb(getConnectionString(c.env));
  const auth = createAuth(db, validateWorkerEnv(c.env as unknown as Record<string, unknown>));
  return auth.handler(c.req.raw);
});

app.all("/trpc/*", (c) => handleTrpcRequest(c.req.raw, c.env));

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

export default app;
