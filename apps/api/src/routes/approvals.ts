import { ApprovalDecisionSchema } from "@abadge/core";
import { and, type Database, eq } from "@abadge/db";
import { approvals, credentials } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

const approvalColumns = {
  id: approvals.id,
  requesterId: approvals.requesterId,
  approverId: approvals.approverId,
  credentialId: approvals.credentialId,
  agentId: approvals.agentId,
  status: approvals.status,
  deliveryMode: approvals.deliveryMode,
  reason: approvals.reason,
  decidedAt: approvals.decidedAt,
  expiresAt: approvals.expiresAt,
  createdAt: approvals.createdAt,
} as const;

/** Fetch a pending approval owned by the given user, returning an error tuple on failure. */
async function findPendingApproval(
  db: Database,
  approvalId: string,
  userId: string,
): Promise<{ error: { message: string; status: 404 | 409 } } | { approval: { id: string } }> {
  const rows = await db
    .select({ id: approvals.id, status: approvals.status, expiresAt: approvals.expiresAt })
    .from(approvals)
    .innerJoin(credentials, eq(approvals.credentialId, credentials.id))
    .where(and(eq(approvals.id, approvalId), eq(credentials.userId, userId)));

  const existing = rows[0];
  if (!existing) {
    return { error: { message: "Approval not found", status: 404 } };
  }
  if (existing.expiresAt < new Date()) {
    return { error: { message: "Approval has expired", status: 409 } };
  }
  if (existing.status !== "pending") {
    return { error: { message: "Approval is not pending", status: 409 } };
  }
  return { approval: existing };
}

export const approvalRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const status = c.req.query("status");

    const conditions = [eq(credentials.userId, userId)];
    if (status) {
      conditions.push(
        eq(approvals.status, status as "pending" | "approved" | "denied" | "expired"),
      );
    }

    const results = await db
      .select(approvalColumns)
      .from(approvals)
      .innerJoin(credentials, eq(approvals.credentialId, credentials.id))
      .where(and(...conditions));

    return c.json({ approvals: results });
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const rows = await db
      .select(approvalColumns)
      .from(approvals)
      .innerJoin(credentials, eq(approvals.credentialId, credentials.id))
      .where(and(eq(approvals.id, id), eq(credentials.userId, userId)));

    const approval = rows[0];
    if (!approval) {
      return c.json({ error: "Approval not found" }, 404);
    }
    return c.json({ approval });
  })
  .post("/:id/approve", zValidator("json", ApprovalDecisionSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const result = await findPendingApproval(db, id, userId);
    if ("error" in result) {
      return c.json({ error: result.error.message }, result.error.status);
    }

    await db
      .update(approvals)
      .set({ status: "approved", approverId: userId, decidedAt: new Date() })
      .where(eq(approvals.id, id));

    return c.json({ success: true });
  })
  .post("/:id/deny", zValidator("json", ApprovalDecisionSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const result = await findPendingApproval(db, id, userId);
    if ("error" in result) {
      return c.json({ error: result.error.message }, result.error.status);
    }

    await db
      .update(approvals)
      .set({
        status: "denied",
        approverId: userId,
        decidedAt: new Date(),
        reason: body.reason ?? null,
      })
      .where(eq(approvals.id, id));

    return c.json({ success: true });
  });
