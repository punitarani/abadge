import { CreateConnectorSchema, UpdateConnectorSchema } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { connectors } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { createHttpConnector, isHttpConnectorType } from "../lib/connectors";
import { decrypt, encrypt } from "../lib/crypto";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const connectorRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const results = await db
      .select({
        id: connectors.id,
        name: connectors.name,
        type: connectors.type,
        enabled: connectors.enabled,
        lastSync: connectors.lastSync,
        createdAt: connectors.createdAt,
        updatedAt: connectors.updatedAt,
      })
      .from(connectors)
      .where(eq(connectors.userId, userId));
    return c.json({ connectors: results });
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const connector = await db.query.connectors.findFirst({
      where: and(eq(connectors.id, id), eq(connectors.userId, userId)),
      columns: {
        id: true,
        name: true,
        type: true,
        enabled: true,
        lastSync: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!connector) {
      return c.json({ error: "Connector not found" }, 404);
    }
    return c.json({ connector });
  })
  .post("/", zValidator("json", CreateConnectorSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const body = c.req.valid("json");

    let encryptedConfig: string | null = null;
    let configIv: string | null = null;

    if (body.config) {
      const { ciphertext, iv } = await encrypt(JSON.stringify(body.config), c.env.ENCRYPTION_KEY);
      encryptedConfig = ciphertext;
      configIv = iv;
    }

    const rows = await db
      .insert(connectors)
      .values({
        id: crypto.randomUUID(),
        userId,
        name: body.name,
        type: body.type,
        encryptedConfig,
        configIv,
      })
      .returning();

    const created = rows[0];
    if (!created) {
      return c.json({ error: "Failed to create connector" }, 500);
    }
    return c.json({ connector: { id: created.id, name: created.name } }, 201);
  })
  .put("/:id", zValidator("json", UpdateConnectorSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.connectors.findFirst({
      where: and(eq(connectors.id, id), eq(connectors.userId, userId)),
      columns: { id: true, name: true },
    });

    if (!existing) {
      return c.json({ error: "Connector not found" }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name) updates.name = body.name;
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    if (body.config) {
      const { ciphertext, iv } = await encrypt(JSON.stringify(body.config), c.env.ENCRYPTION_KEY);
      updates.encryptedConfig = ciphertext;
      updates.configIv = iv;
    }

    await db.update(connectors).set(updates).where(eq(connectors.id, id));

    return c.json({ connector: { id, name: body.name ?? existing.name } });
  })
  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const existing = await db.query.connectors.findFirst({
      where: and(eq(connectors.id, id), eq(connectors.userId, userId)),
      columns: { id: true },
    });

    if (!existing) {
      return c.json({ error: "Connector not found" }, 404);
    }

    await db.delete(connectors).where(eq(connectors.id, id));
    return c.json({ success: true });
  })
  .post("/:id/test", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const connector = await db.query.connectors.findFirst({
      where: and(eq(connectors.id, id), eq(connectors.userId, userId)),
    });

    if (!connector) {
      return c.json({ error: "Connector not found" }, 404);
    }

    if (connector.type === "native") {
      return c.json({ success: true });
    }

    // HTTP connectors can be tested server-side
    if (isHttpConnectorType(connector.type)) {
      if (!connector.encryptedConfig || !connector.configIv) {
        return c.json({ success: false, error: "Connector has no config" });
      }

      const httpConnector = createHttpConnector(connector.type);
      if (!httpConnector) {
        return c.json({ success: false, error: "Unknown HTTP connector type" });
      }

      try {
        const configJson = await decrypt(
          connector.encryptedConfig,
          connector.configIv,
          c.env.ENCRYPTION_KEY,
        );
        const config = JSON.parse(configJson) as Record<string, unknown>;
        return c.json(await httpConnector.testConnection(config));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Test failed";
        return c.json({ success: false, error: msg });
      }
    }

    // Client-side connectors (1Password, AWS, etc.) require local broker
    return c.json({
      success: false,
      error: "Connector testing requires local broker",
    });
  });
