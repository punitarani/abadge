import { CreateCredentialSchema, UpdateCredentialSchema } from "@abadge/core";
import { and, eq } from "@abadge/db";
import { credentials } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { encrypt } from "../lib/crypto";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

const nullableFields = [
  "metadata",
  "ownerScope",
  "environment",
  "service",
  "provider",
  "project",
  "tags",
  "sensitivity",
  "allowedDeliveryModes",
  "allowedDestinations",
  "connectorId",
  "externalRef",
] as const;

function buildCredentialUpdates(
  body: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const updates: Record<string, unknown> = { updatedAt: new Date(), updatedBy: userId };
  if (body.name) updates.name = body.name;
  if (body.type) updates.type = body.type;
  for (const field of nullableFields) {
    if (body[field] !== undefined) updates[field] = body[field] ?? null;
  }
  if (body.sourceType !== undefined) updates.sourceType = body.sourceType;
  return updates;
}

/** Columns safe to return — never includes encryptedValue or iv */
const publicColumns = {
  id: credentials.id,
  name: credentials.name,
  type: credentials.type,
  metadata: credentials.metadata,
  ownerScope: credentials.ownerScope,
  environment: credentials.environment,
  service: credentials.service,
  provider: credentials.provider,
  project: credentials.project,
  tags: credentials.tags,
  sensitivity: credentials.sensitivity,
  allowedDeliveryModes: credentials.allowedDeliveryModes,
  allowedDestinations: credentials.allowedDestinations,
  sourceType: credentials.sourceType,
  connectorId: credentials.connectorId,
  externalRef: credentials.externalRef,
  createdBy: credentials.createdBy,
  updatedBy: credentials.updatedBy,
  createdAt: credentials.createdAt,
  updatedAt: credentials.updatedAt,
} as const;

export const credentialRoutes = new Hono<Env>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const userId = c.get("userId");
    const db = c.get("db");
    const results = await db
      .select(publicColumns)
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
        ownerScope: true,
        environment: true,
        service: true,
        provider: true,
        project: true,
        tags: true,
        sensitivity: true,
        allowedDeliveryModes: true,
        allowedDestinations: true,
        sourceType: true,
        connectorId: true,
        externalRef: true,
        createdBy: true,
        updatedBy: true,
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

    let encryptedValue = "";
    let iv = "";
    if (body.value) {
      const encrypted = await encrypt(body.value, c.env.ENCRYPTION_KEY);
      encryptedValue = encrypted.ciphertext;
      iv = encrypted.iv;
    }

    const rows = await db
      .insert(credentials)
      .values({
        userId,
        name: body.name,
        type: body.type,
        encryptedValue,
        iv,
        metadata: body.metadata ?? null,
        ownerScope: body.ownerScope ?? null,
        environment: body.environment ?? null,
        service: body.service ?? null,
        provider: body.provider ?? null,
        project: body.project ?? null,
        tags: body.tags ?? null,
        sensitivity: body.sensitivity ?? null,
        allowedDeliveryModes: body.allowedDeliveryModes ?? null,
        allowedDestinations: body.allowedDestinations ?? null,
        sourceType: body.sourceType ?? "native",
        connectorId: body.connectorId ?? null,
        externalRef: body.externalRef ?? null,
        createdBy: userId,
        updatedBy: userId,
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

    const updates = buildCredentialUpdates(body, userId);

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
