import { AddGroupMemberSchema, CreateAgentGroupSchema, UpdateAgentGroupSchema } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { agentGroupMembers, agentGroups, apikey } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const agentGroupRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const results = await db.select().from(agentGroups).where(eq(agentGroups.userId, userId));
    return c.json({ groups: results });
  })
  .post("/", zValidator("json", CreateAgentGroupSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const body = c.req.valid("json");

    const rows = await db
      .insert(agentGroups)
      .values({
        id: crypto.randomUUID(),
        userId,
        name: body.name,
        description: body.description ?? null,
      })
      .returning();

    const created = rows[0];
    if (!created) {
      return c.json({ error: "Failed to create agent group" }, 500);
    }
    return c.json({ group: created }, 201);
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const group = await db.query.agentGroups.findFirst({
      where: and(eq(agentGroups.id, id), eq(agentGroups.userId, userId)),
    });

    if (!group) {
      return c.json({ error: "Agent group not found" }, 404);
    }

    const members = await db
      .select()
      .from(agentGroupMembers)
      .where(eq(agentGroupMembers.groupId, id));

    return c.json({ group, members });
  })
  .put("/:id", zValidator("json", UpdateAgentGroupSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.agentGroups.findFirst({
      where: and(eq(agentGroups.id, id), eq(agentGroups.userId, userId)),
    });

    if (!existing) {
      return c.json({ error: "Agent group not found" }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;

    await db.update(agentGroups).set(updates).where(eq(agentGroups.id, id));

    return c.json({ group: { ...existing, ...updates } });
  })
  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const existing = await db.query.agentGroups.findFirst({
      where: and(eq(agentGroups.id, id), eq(agentGroups.userId, userId)),
    });

    if (!existing) {
      return c.json({ error: "Agent group not found" }, 404);
    }

    await db.delete(agentGroups).where(eq(agentGroups.id, id));
    return c.json({ success: true });
  })
  .post("/:id/members", zValidator("json", AddGroupMemberSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const group = await db.query.agentGroups.findFirst({
      where: and(eq(agentGroups.id, id), eq(agentGroups.userId, userId)),
    });

    if (!group) {
      return c.json({ error: "Agent group not found" }, 404);
    }

    const agent = await db.query.apikey.findFirst({
      where: and(eq(apikey.id, body.agentId), eq(apikey.referenceId, userId)),
    });

    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const rows = await db
      .insert(agentGroupMembers)
      .values({ groupId: id, agentId: body.agentId })
      .onConflictDoNothing()
      .returning();

    const member = rows[0];
    if (!member) {
      return c.json({ error: "Agent is already a member of this group" }, 409);
    }
    return c.json({ member }, 201);
  })
  .delete("/:id/members/:agentId", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const agentId = c.req.param("agentId");

    const group = await db.query.agentGroups.findFirst({
      where: and(eq(agentGroups.id, id), eq(agentGroups.userId, userId)),
    });

    if (!group) {
      return c.json({ error: "Agent group not found" }, 404);
    }

    await db
      .delete(agentGroupMembers)
      .where(and(eq(agentGroupMembers.groupId, id), eq(agentGroupMembers.agentId, agentId)));

    return c.json({ success: true });
  });
