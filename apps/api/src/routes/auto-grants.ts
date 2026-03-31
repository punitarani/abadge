import { CreateAutoGrantSchema, UpdateAutoGrantSchema } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { apikey, autoGrants, policies } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const autoGrantRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const results = await db.select().from(autoGrants).where(eq(autoGrants.userId, userId));
    return c.json({ autoGrants: results });
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const autoGrant = await db.query.autoGrants.findFirst({
      where: and(eq(autoGrants.id, id), eq(autoGrants.userId, userId)),
    });

    if (!autoGrant) {
      return c.json({ error: "Auto-grant not found" }, 404);
    }
    return c.json({ autoGrant });
  })
  .post("/", zValidator("json", CreateAutoGrantSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const body = c.req.valid("json");

    // Verify agent belongs to user
    const agent = await db.query.apikey.findFirst({
      where: and(eq(apikey.id, body.agentId), eq(apikey.referenceId, userId)),
    });

    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    // Verify policy belongs to user if provided
    if (body.policyId) {
      const policy = await db.query.policies.findFirst({
        where: and(eq(policies.id, body.policyId), eq(policies.userId, userId)),
      });
      if (!policy) {
        return c.json({ error: "Policy not found" }, 404);
      }
    }

    const rows = await db
      .insert(autoGrants)
      .values({
        id: crypto.randomUUID(),
        agentId: body.agentId,
        userId,
        matchEnvironment: body.matchEnvironment ?? null,
        matchTags: body.matchTags ?? null,
        matchType: body.matchType ?? null,
        matchService: body.matchService ?? null,
        matchSensitivity: body.matchSensitivity ?? null,
        policyId: body.policyId ?? null,
        allowedDeliveryModes: body.allowedDeliveryModes ?? null,
        expiresAt: body.expiresAt ?? null,
      })
      .returning();

    const created = rows[0];
    if (!created) {
      return c.json({ error: "Failed to create auto-grant" }, 500);
    }
    return c.json({ autoGrant: created }, 201);
  })
  .put("/:id", zValidator("json", UpdateAutoGrantSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.autoGrants.findFirst({
      where: and(eq(autoGrants.id, id), eq(autoGrants.userId, userId)),
    });

    if (!existing) {
      return c.json({ error: "Auto-grant not found" }, 404);
    }

    // Verify policy belongs to user if being updated
    if (body.policyId) {
      const policy = await db.query.policies.findFirst({
        where: and(eq(policies.id, body.policyId), eq(policies.userId, userId)),
      });
      if (!policy) {
        return c.json({ error: "Policy not found" }, 404);
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.matchEnvironment !== undefined) updates.matchEnvironment = body.matchEnvironment;
    if (body.matchTags !== undefined) updates.matchTags = body.matchTags;
    if (body.matchType !== undefined) updates.matchType = body.matchType;
    if (body.matchService !== undefined) updates.matchService = body.matchService;
    if (body.matchSensitivity !== undefined) updates.matchSensitivity = body.matchSensitivity;
    if (body.policyId !== undefined) updates.policyId = body.policyId;
    if (body.allowedDeliveryModes !== undefined)
      updates.allowedDeliveryModes = body.allowedDeliveryModes;
    if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt;

    await db.update(autoGrants).set(updates).where(eq(autoGrants.id, id));

    return c.json({ autoGrant: { ...existing, ...updates } });
  })
  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const existing = await db.query.autoGrants.findFirst({
      where: and(eq(autoGrants.id, id), eq(autoGrants.userId, userId)),
    });

    if (!existing) {
      return c.json({ error: "Auto-grant not found" }, 404);
    }

    await db.delete(autoGrants).where(eq(autoGrants.id, id));
    return c.json({ success: true });
  });
