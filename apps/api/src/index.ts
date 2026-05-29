import { createAuth, getTrustedOrigins } from "@abadge/auth";
import { sql } from "@abadge/db";
import { validateWorkerEnv } from "@abadge/env/worker";
import { handleTrpcRequest } from "@abadge/trpc/server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import {
  authMdDocument,
  authorizationServerMetadata,
  handleAgentClaim,
  handleAgentClaimComplete,
  handleAgentRegister,
  protectedResourceMetadata,
} from "./auth-md";
import { getConnectionString, getDb } from "./lib/db";
import { authEnvelopeMiddleware } from "./middleware/auth-envelope";
import { noStore } from "./middleware/no-store";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { requestId } from "./middleware/request-id";
import { wwwAuthenticate } from "./middleware/www-authenticate";
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
// Advertise auth.md discovery on any 401 (RFC 9728 bootstrap).
app.use("*", wwwAuthenticate);
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
// auth.md registration is unauthenticated and creates rows — limit like /api/auth.
app.use("/agent/auth", rateLimitMiddleware(60, 60_000));
app.use("/agent/auth/*", rateLimitMiddleware(60, 60_000));

// These prefixes carry plaintext, ciphertext, or session tokens; mark their
// responses uncacheable so no browser, proxy, or service worker can persist one.
app.use("/api/auth/*", noStore);
app.use("/trpc/*", noStore);
app.use("/v1/*", noStore);
app.use("/agent/auth", noStore);
app.use("/agent/auth/*", noStore);

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

// auth.md agentic registration (WorkOS protocol). Discovery docs + the
// unauthenticated registration/claim endpoints. Registered before the
// catch-alls so they take precedence.
app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResourceMetadata(c.env)));
app.get("/.well-known/oauth-authorization-server", (c) =>
  c.json(authorizationServerMetadata(c.env)),
);
app.get("/auth.md", (c) => c.text(authMdDocument(c.env), 200, { "Content-Type": "text/markdown" }));
app.post("/agent/auth", handleAgentRegister);
app.post("/agent/auth/claim", handleAgentClaim);
app.post("/agent/auth/claim/complete", handleAgentClaimComplete);

app.all("/trpc/*", (c) => handleTrpcRequest(c.req.raw, c.env));

// Canonical REST surface. Routes are derived from the tRPC router's
// `.meta({ openapi })` annotations — see `apps/api/src/rest/v1.ts`.
// `/v1/openapi.json` must be registered BEFORE the `/v1/*` catch-all so
// the spec endpoint isn't shadowed.
app.get("/v1/openapi.json", (c) => c.json(getOpenApiDocument()));
app.all("/v1/*", (c) => handleV1Request(c));

// Health check — liveness plus a lightweight DB-reachability probe.
//
// This endpoint is unauthenticated and unrate-limited, so it deliberately does
// NOT expose the DB role name or its attributes in the response body (that would
// leak the internal role to anonymous callers). The deployment-time role
// assertions are logged for operators here, not part of the public contract:
//   - rolbypassrls must be false once the least-privilege role is live (§AB-0011),
//   - the role must NOT hold UPDATE on audit_logs (§AB-0012/§AB-0020).
//
// Failure semantics: a configured-but-unreachable DB returns 503 `degraded` so
// load balancers and uptime probes detect the outage instead of seeing a masked
// `ok`. `db: null` means no DB binding is configured (e.g. the unit-test env).
app.get("/health", async (c) => {
  const connectionString = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL;
  if (!connectionString) {
    return c.json({ status: "ok", db: null });
  }
  try {
    const db = getDb(connectionString);
    const [row] = await db.execute(
      sql`SELECT current_user AS role, rolbypassrls,
                 has_table_privilege(current_user, 'audit_logs', 'UPDATE') AS audit_update
          FROM pg_roles WHERE rolname = current_user`,
    );
    const r = row as { role: string; rolbypassrls: boolean; audit_update: boolean } | undefined;
    // Operator signals in logs only — never in the anon-visible payload.
    console.info(`[health] db reachable role=${r?.role ?? "unknown"} bypassRls=${r?.rolbypassrls}`);
    if (r?.audit_update === true) {
      console.warn(
        "[§AB-0012] current DB role has UPDATE on audit_logs — run migration " +
          "0023_least_privilege_role to revoke write access.",
      );
    }
    return c.json({ status: "ok", db: { reachable: true } });
  } catch (err) {
    console.error("[health] db probe failed", err);
    return c.json({ status: "degraded", db: { reachable: false } }, 503);
  }
});

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
