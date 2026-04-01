import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, isNull } from "@abadge/db";
import { items, vaults } from "@abadge/db/schema";
import { CreateItemSchema, UpdateItemSchema } from "@abadge/core";
import { serverEncrypt } from "@abadge/crypto/server";
import { authMiddleware } from "../middleware/auth";
import { logAudit } from "../lib/audit";
import type { Env } from "../types";

export const itemRoutes = new Hono<Env>();

itemRoutes.use("*", authMiddleware);

// POST /items — Create item
itemRoutes.post("/", zValidator("json", CreateItemSchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const body = c.req.valid("json");
  const id = crypto.randomUUID();

  if (body.storageMode === "zero_knowledge") {
    const [vault] = await db.select({ id: vaults.id }).from(vaults).where(eq(vaults.userId, userId)).limit(1);
    if (!vault) {
      return c.json({ error: "Vault not bootstrapped" }, 400);
    }

    await db.insert(items).values({
      id,
      userId,
      vaultId: vault.id,
      storageMode: "zero_knowledge",
      encryptedItemKey: body.encryptedItemKey,
      ciphertext: body.ciphertext,
    });
  } else {
    const plaintext = new TextEncoder().encode(JSON.stringify(body.payload));
    const encrypted = await serverEncrypt(plaintext, c.env.ENCRYPTION_KEY, 1);

    await db.insert(items).values({
      id,
      userId,
      storageMode: "server_managed",
      serverCiphertext: encrypted.ciphertext,
      serverIv: encrypted.iv,
      serverKeyVersion: encrypted.keyVersion,
    });
  }

  await logAudit(db, { userId, itemId: id, eventType: "item.create", result: "allowed" });

  return c.json({ id }, 201);
});

// GET /items — List items (metadata only, no ciphertext)
itemRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");

  const result = await db
    .select({
      id: items.id,
      storageMode: items.storageMode,
      cryptoVersion: items.cryptoVersion,
      contentVersion: items.contentVersion,
      createdAt: items.createdAt,
      updatedAt: items.updatedAt,
    })
    .from(items)
    .where(and(eq(items.userId, userId), isNull(items.deletedAt)));

  return c.json(
    result.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
});

// GET /items/:id — Get item (includes ciphertext for ZK items)
itemRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const itemId = c.req.param("id");

  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId), isNull(items.deletedAt)))
    .limit(1);

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  await logAudit(db, { userId, itemId, eventType: "item.read", result: "allowed" });

  if (item.storageMode === "zero_knowledge") {
    return c.json({
      id: item.id,
      storageMode: item.storageMode,
      encryptedItemKey: item.encryptedItemKey,
      ciphertext: item.ciphertext,
      cryptoVersion: item.cryptoVersion,
      contentVersion: item.contentVersion,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    });
  }

  // Server-managed: return metadata only (reveal via access route)
  return c.json({
    id: item.id,
    storageMode: item.storageMode,
    cryptoVersion: item.cryptoVersion,
    contentVersion: item.contentVersion,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  });
});

// PUT /items/:id — Update item
itemRoutes.put("/:id", zValidator("json", UpdateItemSchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const itemId = c.req.param("id");
  const body = c.req.valid("json");

  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId), isNull(items.deletedAt)))
    .limit(1);

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  if (item.contentVersion !== body.contentVersion) {
    return c.json({ error: "Stale version — reload and retry" }, 409);
  }

  if (body.storageMode === "zero_knowledge") {
    await db
      .update(items)
      .set({
        encryptedItemKey: body.encryptedItemKey,
        ciphertext: body.ciphertext,
        contentVersion: item.contentVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
  } else {
    const plaintext = new TextEncoder().encode(JSON.stringify(body.payload));
    const encrypted = await serverEncrypt(plaintext, c.env.ENCRYPTION_KEY, 1);

    await db
      .update(items)
      .set({
        serverCiphertext: encrypted.ciphertext,
        serverIv: encrypted.iv,
        serverKeyVersion: encrypted.keyVersion,
        contentVersion: item.contentVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(items.id, itemId));
  }

  await logAudit(db, { userId, itemId, eventType: "item.update", result: "allowed" });

  return c.json({ ok: true, contentVersion: item.contentVersion + 1 });
});

// DELETE /items/:id — Soft delete
itemRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const itemId = c.req.param("id");

  const [item] = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, userId), isNull(items.deletedAt)))
    .limit(1);

  if (!item) {
    return c.json({ error: "Item not found" }, 404);
  }

  await db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, itemId));

  await logAudit(db, { userId, itemId, eventType: "item.delete", result: "allowed" });

  return c.json({ ok: true });
});
