import { createAuth } from "@abadge/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getConnectionString, getDb } from "./lib/db";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { accessRoutes } from "./routes/access";
import { agentRoutes } from "./routes/agents";
import { auditRoutes } from "./routes/audit";
import { credentialRoutes } from "./routes/credentials";
import { permissionRoutes } from "./routes/permissions";
import type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

// Global middleware
app.use("*", secureHeaders());
app.use(
  "*",
  cors({
    origin: ["https://abadge.dev", "http://localhost:3000"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Rate limit auth endpoints more aggressively
app.use("/api/auth/*", rateLimitMiddleware(60, 60_000));
app.use("/api/v1/*", rateLimitMiddleware(100, 60_000));

// Better Auth catch-all route
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const db = getDb(getConnectionString(c.env));
  const auth = createAuth(db, {
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  });
  return auth.handler(c.req.raw);
});

// Dashboard routes (session-authenticated) — registered individually to avoid deep type chains
app.route("/api/credentials", credentialRoutes);
app.route("/api/agents", agentRoutes);
app.route("/api/permissions", permissionRoutes);
app.route("/api/audit", auditRoutes);

// Agent-facing route (API key-authenticated)
app.route("/api/v1", accessRoutes);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Export individual route types for RPC client usage
export type CredentialRoutesType = typeof credentialRoutes;
export type AgentRoutesType = typeof agentRoutes;
export type PermissionRoutesType = typeof permissionRoutes;
export type AuditRoutesType = typeof auditRoutes;
export type AccessRoutesType = typeof accessRoutes;

export default app;
