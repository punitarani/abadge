import { CreateCredentialSchema, UpdateCredentialSchema } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { credentials } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { encrypt } from "../lib/crypto";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const credentialRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const results = await db
      .select({
        id: credentials.id,
        name: credentials.name,
        type: credentials.type,
        metadata: credentials.metadata,
        createdAt: credentials.createdAt,
        updatedAt: credentials.updatedAt,
      })
      .from(credentials)
      .where(eq(credentials.userId, userId));
    return c.json({ credentials: results });
  })
  .get("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const credential = await db.query.credentials.findFirst({
      where: and(eq(credentials.id, id), eq(credentials.userId, userId)),
      columns: {
        id: true,
        name: true,
        type: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!credential) {
      return c.json({ error: "Credential not found" }, 404);
    }
    return c.json({ credential });
  })
  .post("/", zValidator("json", CreateCredentialSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const body = c.req.valid("json");

    const { ciphertext, iv } = await encrypt(body.value, c.env.ENCRYPTION_KEY);

    const rows = await db
      .insert(credentials)
      .values({
        userId,
        name: body.name,
        type: body.type,
        encryptedValue: ciphertext,
        iv,
        metadata: body.metadata ?? null,
      })
      .returning();

    const created = rows[0];
    if (!created) {
      return c.json({ error: "Failed to create credential" }, 500);
    }
    return c.json({ credential: { id: created.id, name: created.name } }, 201);
  })
  .put("/:id", zValidator("json", UpdateCredentialSchema), async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const existing = await db.query.credentials.findFirst({
      where: and(eq(credentials.id, id), eq(credentials.userId, userId)),
    });

    if (!existing) {
      return c.json({ error: "Credential not found" }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name) updates.name = body.name;
    if (body.type) updates.type = body.type;
    if (body.metadata !== undefined) updates.metadata = body.metadata ?? null;

    if (body.value) {
      const { ciphertext, iv } = await encrypt(body.value, c.env.ENCRYPTION_KEY);
      updates.encryptedValue = ciphertext;
      updates.iv = iv;
    }

    await db.update(credentials).set(updates).where(eq(credentials.id, id));

    return c.json({ credential: { id, name: body.name ?? existing.name } });
  })
  .delete("/:id", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const id = c.req.param("id");

    const existing = await db.query.credentials.findFirst({
      where: and(eq(credentials.id, id), eq(credentials.userId, userId)),
    });

    if (!existing) {
      return c.json({ error: "Credential not found" }, 404);
    }

    await db.delete(credentials).where(eq(credentials.id, id));
    return c.json({ success: true });
  });
