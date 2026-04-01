import { createAuth } from "@abadge/auth";
import { and, eq, gt, isNull } from "@abadge/db";
import { apikey, brokerSessions } from "@abadge/db/schema";
import { createMiddleware } from "hono/factory";
import { hashToken } from "../lib/crypto";
import { getConnectionString, getDb } from "../lib/db";
import type { AgentEnv } from "../types";

export const agentAuthMiddleware = createMiddleware<AgentEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);
  const db = getDb(getConnectionString(c.env));

  // Session token path
  if (token.startsWith("abs_")) {
    const tokenHash = await hashToken(token);

    const session = await db.query.brokerSessions.findFirst({
      where: and(
        eq(brokerSessions.tokenHash, tokenHash),
        gt(brokerSessions.expiresAt, new Date()),
        isNull(brokerSessions.revokedAt),
      ),
    });

    if (!session) {
      return c.json({ error: "Invalid or expired session token" }, 401);
    }

    const agent = await db.query.apikey.findFirst({
      where: eq(apikey.id, session.agentId),
    });

    if (!agent?.enabled) {
      return c.json({ error: "Agent not found or disabled" }, 401);
    }

    c.set("agent", agent);
    c.set("db", db);
    c.set("sessionId", session.id);
    await next();
    return;
  }

  // API key path
  const auth = createAuth(db, {
    API_URL: c.env.API_URL,
    APP_URL: c.env.APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: c.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: c.env.GITHUB_CLIENT_SECRET,
  });

  const result = await auth.api.verifyApiKey({
    body: { key: token },
  });

  if (!result.valid || !result.key) {
    return c.json({ error: "Invalid or inactive API key" }, 401);
  }

  c.set("agent", result.key);
  c.set("db", db);
  await next();
});
