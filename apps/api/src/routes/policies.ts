import { CreatePolicySchema, UpdatePolicySchema } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { policies } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const policyRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const results = await db.select().from(policies).where(eq(policies.userId, userId));
    return c.json({ policies: results });
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const policy = await db.query.policies.findFirst({
      where: and(eq(policies.id, id), eq(policies.userId, userId)),
    });

    if (!policy) {
      return c.json({ error: "Policy not found" }, 404);
    }
    return c.json({ policy });
  })
  .post("/", zValidator("json", CreatePolicySchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const body = c.req.valid("json");

    const rows = await db
      .insert(policies)
      .values({
        id: crypto.randomUUID(),
        userId,
        name: body.name,
        credentialId: body.credentialId ?? null,
        rules: body.rules,
      })
      .returning();

    const created = rows[0];
    if (!created) {
      return c.json({ error: "Failed to create policy" }, 500);
    }
    return c.json({ policy: created }, 201);
  })
  .put("/:id", zValidator("json", UpdatePolicySchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.policies.findFirst({
      where: and(eq(policies.id, id), eq(policies.userId, userId)),
    });

    if (!existing) {
      return c.json({ error: "Policy not found" }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.rules !== undefined) updates.rules = body.rules;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    await db.update(policies).set(updates).where(eq(policies.id, id));

    return c.json({ policy: { ...existing, ...updates } });
  })
  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const existing = await db.query.policies.findFirst({
      where: and(eq(policies.id, id), eq(policies.userId, userId)),
    });

    if (!existing) {
      return c.json({ error: "Policy not found" }, 404);
    }

    await db.delete(policies).where(eq(policies.id, id));
    return c.json({ success: true });
  });
