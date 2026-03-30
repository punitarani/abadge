import { AgentAccessRequestSchema } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { accessLog, agentCredentialPermissions, credentials } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { decrypt } from "../lib/crypto";
import { agentAuthMiddleware } from "../middleware/agent-auth";
import type { AgentEnv } from "../types";

export const accessRoutes = new Hono<AgentEnv>()
  .use("*", agentAuthMiddleware)
  .post("/credentials/access", zValidator("json", AgentAccessRequestSchema), async (c) => {
    const agent = c.get("agent");
    const db = c.get("db");
    const body = c.req.valid("json");

    const agentId = agent.id as string;
    const agentUserId = agent.referenceId as string;
    const agentName = (agent.name as string) ?? "unknown";

    // Find the credential — always scoped to the agent's owner
    const credentialName = body.credentialName;
    const credential = body.credentialId
      ? await db.query.credentials.findFirst({
          where: and(eq(credentials.id, body.credentialId), eq(credentials.userId, agentUserId)),
        })
      : credentialName
        ? await db.query.credentials.findFirst({
            where: and(eq(credentials.name, credentialName), eq(credentials.userId, agentUserId)),
          })
        : undefined;

    if (!credential) {
      return c.json({ error: "Credential not found" }, 404);
    }

    // Check permission
    const permission = await db.query.agentCredentialPermissions.findFirst({
      where: and(
        eq(agentCredentialPermissions.agentId, agentId),
        eq(agentCredentialPermissions.credentialId, credential.id),
      ),
    });

    if (!permission) {
      await db.insert(accessLog).values({
        agentId,
        credentialId: credential.id,
        credentialName: credential.name,
        agentName,
        action: "denied",
        purpose: body.purpose,
        ipAddress: c.req.header("cf-connecting-ip"),
      });
      return c.json({ error: "Access denied" }, 403);
    }

    // Decrypt and return
    const decryptedValue = await decrypt(
      credential.encryptedValue,
      credential.iv,
      c.env.ENCRYPTION_KEY,
    );

    // Log successful access
    await db.insert(accessLog).values({
      agentId,
      credentialId: credential.id,
      credentialName: credential.name,
      agentName,
      action: "read",
      purpose: body.purpose,
      ipAddress: c.req.header("cf-connecting-ip"),
    });

    return c.json({
      credential: {
        name: credential.name,
        type: credential.type,
        value: decryptedValue,
        metadata: credential.metadata,
      },
    });
  });
