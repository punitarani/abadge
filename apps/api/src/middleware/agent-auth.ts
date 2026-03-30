import { createAuth } from "@abadge/auth";
import { createMiddleware } from "hono/factory";
import { getConnectionString, getDb } from "../lib/db";
import type { AgentEnv } from "../types";

export const agentAuthMiddleware = createMiddleware<AgentEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const apiKeyValue = authHeader.slice(7);

  const db = getDb(getConnectionString(c.env));
  const auth = createAuth(db, {
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
  });

  const result = await auth.api.verifyApiKey({
    body: { key: apiKeyValue },
  });

  if (!result.valid || !result.key) {
    return c.json({ error: "Invalid or inactive API key" }, 401);
  }

  c.set("agent", result.key);
  c.set("db", db);
  await next();
});
