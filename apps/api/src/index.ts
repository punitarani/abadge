import { createAuth, getTrustedOrigins } from "@abadge/auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getConnectionString, getDb } from "./lib/db";
import { rateLimitMiddleware } from "./middleware/rate-limit";
import { accessRoutes } from "./routes/access";
import { auditRoutes } from "./routes/audit";
import { grantRoutes } from "./routes/grants";
import { itemRoutes } from "./routes/items";
import { principalRoutes } from "./routes/principals";
import { vaultRoutes } from "./routes/vault";
import type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

// Global middleware
app.use("*", secureHeaders());
app.use("*", async (c, next) =>
  cors({
    origin: getTrustedOrigins(c.env),
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })(c, next),
);

// Rate limiting
app.use("/api/auth/*", rateLimitMiddleware(60, 60_000));
app.use("/v1/*", rateLimitMiddleware(100, 60_000));

// Better Auth catch-all route
app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const db = getDb(getConnectionString(c.env));
  const auth = createAuth(db, c.env);
  return auth.handler(c.req.raw);
});

// v1 API routes
app.route("/v1/vault", vaultRoutes);
app.route("/v1/items", itemRoutes);
app.route("/v1/principals", principalRoutes);
app.route("/v1/grants", grantRoutes);
app.route("/v1/access", accessRoutes);
app.route("/v1/audit", auditRoutes);

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

export default app;
