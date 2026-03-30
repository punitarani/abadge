import { GrantPermissionSchema, RevokePermissionSchema } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { agentCredentialPermissions, apikey, credentials } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const permissionRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/credential/:credentialId", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const credentialId = c.req.param("credentialId");

    // Verify the credential belongs to the user
    const credential = await db.query.credentials.findFirst({
      where: and(eq(credentials.id, credentialId), eq(credentials.userId, userId)),
    });

    if (!credential) {
      return c.json({ error: "Credential not found" }, 404);
    }

    const permissions = await db
      .select({
        agentId: agentCredentialPermissions.agentId,
        credentialId: agentCredentialPermissions.credentialId,
        grantedAt: agentCredentialPermissions.grantedAt,
        grantedBy: agentCredentialPermissions.grantedBy,
        agentName: apikey.name,
        agentEnabled: apikey.enabled,
      })
      .from(agentCredentialPermissions)
      .innerJoin(apikey, eq(agentCredentialPermissions.agentId, apikey.id))
      .where(eq(agentCredentialPermissions.credentialId, credentialId));

    return c.json({ permissions });
  })
  .post("/grant", zValidator("json", GrantPermissionSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const body = c.req.valid("json");

    // Verify both agent (apikey) and credential belong to the user
    const [agent, credential] = await Promise.all([
      db.query.apikey.findFirst({
        where: and(eq(apikey.id, body.agentId), eq(apikey.referenceId, userId)),
      }),
      db.query.credentials.findFirst({
        where: and(eq(credentials.id, body.credentialId), eq(credentials.userId, userId)),
      }),
    ]);

    if (!agent) return c.json({ error: "Agent not found" }, 404);
    if (!credential) return c.json({ error: "Credential not found" }, 404);

    // Check if permission already exists
    const existing = await db.query.agentCredentialPermissions.findFirst({
      where: and(
        eq(agentCredentialPermissions.agentId, body.agentId),
        eq(agentCredentialPermissions.credentialId, body.credentialId),
      ),
    });

    if (existing) {
      return c.json({ error: "Permission already exists" }, 409);
    }

    await db.insert(agentCredentialPermissions).values({
      agentId: body.agentId,
      credentialId: body.credentialId,
      grantedBy: userId,
    });

    return c.json({ success: true }, 201);
  })
  .post("/revoke", zValidator("json", RevokePermissionSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const body = c.req.valid("json");

    // Verify agent belongs to user
    const agent = await db.query.apikey.findFirst({
      where: and(eq(apikey.id, body.agentId), eq(apikey.referenceId, userId)),
    });

    if (!agent) return c.json({ error: "Agent not found" }, 404);

    await db
      .delete(agentCredentialPermissions)
      .where(
        and(
          eq(agentCredentialPermissions.agentId, body.agentId),
          eq(agentCredentialPermissions.credentialId, body.credentialId),
        ),
      );

    return c.json({ success: true });
  });
