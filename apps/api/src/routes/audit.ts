import { AuditQuerySchema } from "@abadge/core";
import { and, desc, eq, lt } from "@abadge/db";
import { auditLog } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const auditRoutes = new Hono<Env>();

auditRoutes.use("*", authMiddleware);

// GET /audit — Query audit log (cursor-based pagination)
auditRoutes.get("/", zValidator("query", AuditQuerySchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const query = c.req.valid("query");

  const conditions = [eq(auditLog.userId, userId)];

  if (query.eventType) conditions.push(eq(auditLog.eventType, query.eventType));
  if (query.result) conditions.push(eq(auditLog.result, query.result));
  if (query.principalId) conditions.push(eq(auditLog.principalId, query.principalId));
  if (query.itemId) conditions.push(eq(auditLog.itemId, query.itemId));
  if (query.cursor) conditions.push(lt(auditLog.id, Number(query.cursor)));

  const result = await db
    .select()
    .from(auditLog)
    .where(and(...conditions))
    .orderBy(desc(auditLog.id))
    .limit(query.limit);

  const entries = result.map((e) => ({
    id: e.id,
    userId: e.userId,
    principalId: e.principalId,
    itemId: e.itemId,
    eventType: e.eventType,
    result: e.result,
    deliveryMode: e.deliveryMode,
    meta: e.meta,
    ipAddress: e.ipAddress,
    occurredAt: e.occurredAt.toISOString(),
  }));

  const lastEntry = entries[entries.length - 1];
  const nextCursor = entries.length === query.limit && lastEntry ? String(lastEntry.id) : null;

  return c.json({ entries, nextCursor });
});
