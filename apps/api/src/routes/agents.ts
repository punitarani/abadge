import { CreateAgentSchema } from "@abadge/core";
import { eq } from "@abadge/db";
import { apikey } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const agentRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const results = await db
      .select({
        id: apikey.id,
        name: apikey.name,
        prefix: apikey.prefix,
        start: apikey.start,
        enabled: apikey.enabled,
        lastRequest: apikey.lastRequest,
        metadata: apikey.metadata,
        createdAt: apikey.createdAt,
      })
      .from(apikey)
      .where(eq(apikey.referenceId, userId));
    return c.json({ agents: results });
  })
  .post("/", zValidator("json", CreateAgentSchema), async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");

    // Use Better Auth API to create the API key
    const { createAuth } = await import("@abadge/auth");
    const db = c.get("db");
    const auth = createAuth(db, {
      BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
      BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    });

    const result = await auth.api.createApiKey({
      body: {
        name: body.name,
        userId,
        prefix: "abg_",
        metadata: body.description ? { description: body.description } : undefined,
      },
    });

    return c.json(
      {
        agent: {
          id: result.id,
          name: result.name,
          prefix: result.start,
        },
        apiKey: result.key,
      },
      201,
    );
  })
  .patch("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const body = await c.req.json<{ enabled?: boolean; name?: string; description?: string }>();

    const existing = await db.query.apikey.findFirst({
      where: eq(apikey.id, id),
    });

    if (!existing || existing.referenceId !== userId) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.name) updates.name = body.name;
    if (body.description !== undefined) {
      const existingMeta = existing.metadata ? JSON.parse(existing.metadata) : {};
      updates.metadata = JSON.stringify({ ...existingMeta, description: body.description });
    }

    await db.update(apikey).set(updates).where(eq(apikey.id, id));
    return c.json({ success: true });
  })
  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const existing = await db.query.apikey.findFirst({
      where: eq(apikey.id, id),
    });

    if (!existing || existing.referenceId !== userId) {
      return c.json({ error: "Agent not found" }, 404);
    }

    await db.delete(apikey).where(eq(apikey.id, id));
    return c.json({ success: true });
  });
