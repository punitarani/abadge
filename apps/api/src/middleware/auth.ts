import { createAuth } from "@abadge/auth";
import { createMiddleware } from "hono/factory";
import { getConnectionString, getDb } from "../lib/db";
import type { Env } from "../types";

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const db = getDb(getConnectionString(c.env));
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

  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", session.user.id);
  c.set("db", db);
  await next();
});
