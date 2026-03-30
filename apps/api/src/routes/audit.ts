import { desc, eq, inArray } from "@abadge/db";
import { accessLog, credentials } from "@abadge/db/schema";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const auditRoutes = new Hono<Env>().use("*", authMiddleware).get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);

  // Get all credential IDs belonging to this user
  const userCredentials = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(eq(credentials.userId, userId));

  const credentialIds = userCredentials.map((row) => row.id);

  if (credentialIds.length === 0) {
    return c.json({ logs: [], total: 0 });
  }

  const logs = await db
    .select()
    .from(accessLog)
    .where(inArray(accessLog.credentialId, credentialIds))
    .orderBy(desc(accessLog.timestamp))
    .limit(limit)
    .offset(offset);

  return c.json({ logs });
});
