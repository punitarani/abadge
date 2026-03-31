import { createAuth } from "@abadge/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getConnectionString, getDb } from "./lib/db";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { accessRoutes } from "./routes/access";
import { agentGroupRoutes } from "./routes/agent-groups";
import { agentRoutes } from "./routes/agents";
import { approvalRoutes } from "./routes/approvals";
import { auditRoutes } from "./routes/audit";
import { autoGrantRoutes } from "./routes/auto-grants";
import { connectorRoutes } from "./routes/connectors";
import { credentialRoutes } from "./routes/credentials";
import { permissionRoutes } from "./routes/permissions";
import { policyRoutes } from "./routes/policies";
import { sessionRoutes } from "./routes/sessions";
import type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

// Global middleware
app.use("*", secureHeaders());
app.use("*", async (c, next) =>
  cors({
    origin: [c.env.APP_URL],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })(c, next),
);

// Rate limit auth endpoints more aggressively
app.use("/api/auth/*", rateLimitMiddleware(60, 60_000));
app.use("/v1/*", rateLimitMiddleware(100, 60_000));

// Better Auth catch-all route — must stay at /api/auth/* to match Better Auth's baseURL config
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const db = getDb(getConnectionString(c.env));
  const auth = createAuth(db, {
    API_URL: c.env.API_URL,
    APP_URL: c.env.APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  });
  return auth.handler(c.req.raw);
});

// v1 API routes — registered individually to avoid deep type chains
app.route("/v1/credentials", credentialRoutes);
app.route("/v1/agents", agentRoutes);
app.route("/v1/agent-groups", agentGroupRoutes);
app.route("/v1/permissions", permissionRoutes);
app.route("/v1/audit", auditRoutes);
app.route("/v1/policies", policyRoutes);
app.route("/v1/approvals", approvalRoutes);
app.route("/v1/auto-grants", autoGrantRoutes);
app.route("/v1/connectors", connectorRoutes);
app.route("/v1", accessRoutes);
app.route("/v1/sessions", sessionRoutes);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// Export individual route types for RPC client usage
export type CredentialRoutesType = typeof credentialRoutes;
export type AgentRoutesType = typeof agentRoutes;
export type AgentGroupRoutesType = typeof agentGroupRoutes;
export type PermissionRoutesType = typeof permissionRoutes;
export type AuditRoutesType = typeof auditRoutes;
export type AccessRoutesType = typeof accessRoutes;
export type AutoGrantRoutesType = typeof autoGrantRoutes;
export type PolicyRoutesType = typeof policyRoutes;
export type ApprovalRoutesType = typeof approvalRoutes;
export type ConnectorRoutesType = typeof connectorRoutes;
export type SessionRoutesType = typeof sessionRoutes;

export default app;
