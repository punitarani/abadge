import type { AccessOutcome, DeliveryMode, Environment, PrincipalType } from "@abadge/core";
import type { SQL } from "@abadge/db";
import { and, desc, eq, gte, inArray, lte } from "@abadge/db";
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

  // Build filter conditions
  const conditions: SQL[] = [inArray(accessLog.credentialId, credentialIds)];

  const deliveryMode = c.req.query("deliveryMode");
  if (deliveryMode) {
    conditions.push(eq(accessLog.deliveryMode, deliveryMode as DeliveryMode));
  }

  const outcome = c.req.query("outcome");
  if (outcome) {
    conditions.push(eq(accessLog.outcome, outcome as AccessOutcome));
  }

  const principalType = c.req.query("principalType");
  if (principalType) {
    conditions.push(eq(accessLog.principalType, principalType as PrincipalType));
  }

  const environment = c.req.query("environment");
  if (environment) {
    conditions.push(eq(accessLog.environment, environment as Environment));
  }

  const agentId = c.req.query("agentId");
  if (agentId) {
    conditions.push(eq(accessLog.agentId, agentId));
  }

  const startDate = c.req.query("startDate");
  if (startDate) {
    conditions.push(gte(accessLog.timestamp, new Date(startDate)));
  }

  const endDate = c.req.query("endDate");
  if (endDate) {
    conditions.push(lte(accessLog.timestamp, new Date(endDate)));
  }

  const logs = await db
    .select()
    .from(accessLog)
    .where(and(...conditions))
    .orderBy(desc(accessLog.timestamp))
    .limit(limit)
    .offset(offset);

  return c.json({ logs });
});
