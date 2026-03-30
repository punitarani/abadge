import { CreateSessionSchema } from "@abadge/core";
import { and, eq, gt, isNull } from "@abadge/db";
import { apikey, brokerSessions } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { hashToken } from "../lib/crypto";
import { agentAuthMiddleware } from "../middleware/agent-auth";
import type { AgentEnv } from "../types";

const SESSION_TOKEN_PREFIX = "abs_";

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  return SESSION_TOKEN_PREFIX + base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export const sessionRoutes = new Hono<AgentEnv>()
  .use("*", agentAuthMiddleware)
  .post("/", zValidator("json", CreateSessionSchema), async (c) => {
    const agent = c.get("agent");
    const db = c.get("db");
    const body = c.req.valid("json");

    const agentId = agent.id as string;
    const agentUserId = agent.referenceId as string;

    // Verify the requested agent belongs to the same user
    if (body.agentId !== agentId) {
      const targetAgent = await db.query.apikey.findFirst({
        where: and(eq(apikey.id, body.agentId), eq(apikey.referenceId, agentUserId)),
      });
      if (!targetAgent) {
        return c.json({ error: "Agent not found" }, 404);
      }
    }

    const sessionId = generateSessionId();
    const token = generateToken();
    const tokenHash = await hashToken(token);
    const tokenPrefix = token.slice(0, 8);
    const expiresAt = new Date(Date.now() + body.ttlSeconds * 1000);

    await db.insert(brokerSessions).values({
      id: sessionId,
      tokenHash,
      tokenPrefix,
      agentId: body.agentId,
      userId: agentUserId,
      scopes: body.scopes ?? null,
      allowedDeliveryModes: body.allowedDeliveryModes ?? null,
      expiresAt,
    });

    return c.json({ sessionId, token, expiresAt: expiresAt.toISOString() }, 201);
  })
  .get("/", async (c) => {
    const agent = c.get("agent");
    const db = c.get("db");
    const agentId = agent.id as string;

    const sessions = await db
      .select({
        id: brokerSessions.id,
        tokenPrefix: brokerSessions.tokenPrefix,
        agentId: brokerSessions.agentId,
        scopes: brokerSessions.scopes,
        allowedDeliveryModes: brokerSessions.allowedDeliveryModes,
        expiresAt: brokerSessions.expiresAt,
        createdAt: brokerSessions.createdAt,
      })
      .from(brokerSessions)
      .where(
        and(
          eq(brokerSessions.agentId, agentId),
          gt(brokerSessions.expiresAt, new Date()),
          isNull(brokerSessions.revokedAt),
        ),
      );

    return c.json({ sessions });
  })
  .get("/:id", async (c) => {
    const agent = c.get("agent");
    const db = c.get("db");
    const id = c.req.param("id");
    const agentId = agent.id as string;

    const session = await db.query.brokerSessions.findFirst({
      where: and(eq(brokerSessions.id, id), eq(brokerSessions.agentId, agentId)),
      columns: {
        id: true,
        tokenPrefix: true,
        agentId: true,
        scopes: true,
        allowedDeliveryModes: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json({ session });
  })
  .delete("/:id", async (c) => {
    const agent = c.get("agent");
    const db = c.get("db");
    const id = c.req.param("id");
    const agentId = agent.id as string;

    const session = await db.query.brokerSessions.findFirst({
      where: and(eq(brokerSessions.id, id), eq(brokerSessions.agentId, agentId)),
    });

    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    await db.update(brokerSessions).set({ revokedAt: new Date() }).where(eq(brokerSessions.id, id));

    return c.json({ success: true });
  });
