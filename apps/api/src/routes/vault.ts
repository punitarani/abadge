import {
  ChangePasswordSchema,
  RecoverySetupSchema,
  RotateKeySchema,
  VaultBootstrapSchema,
} from "@abadge/core";
import { eq } from "@abadge/db";
import { items, vaults } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logAudit } from "../lib/audit";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const vaultRoutes = new Hono<Env>();

vaultRoutes.use("*", authMiddleware);

// PUT /vault/bootstrap — Create vault
vaultRoutes.put("/bootstrap", zValidator("json", VaultBootstrapSchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const body = c.req.valid("json");

  // Check if vault already exists
  const [existing] = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(eq(vaults.userId, userId))
    .limit(1);
  if (existing) {
    return c.json({ error: "Vault already exists" }, 409);
  }

  const id = crypto.randomUUID();
  await db.insert(vaults).values({
    id,
    userId,
    wrappedRootKey: body.wrappedRootKey,
    kdfSalt: body.kdfSalt,
    kdfParams: body.kdfParams,
  });

  await logAudit(db, { userId, eventType: "vault.bootstrap", result: "allowed" });

  return c.json({ id }, 201);
});

// GET /vault — Get vault metadata
vaultRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");

  const [vault] = await db.select().from(vaults).where(eq(vaults.userId, userId)).limit(1);
  if (!vault) {
    return c.json({ error: "Vault not found" }, 404);
  }

  return c.json({
    id: vault.id,
    wrappedRootKey: vault.wrappedRootKey,
    kdfSalt: vault.kdfSalt,
    kdfParams: vault.kdfParams,
    recoveryWrappedRootKey: vault.recoveryWrappedRootKey,
    keyVersion: vault.keyVersion,
    createdAt: vault.createdAt.toISOString(),
    updatedAt: vault.updatedAt.toISOString(),
  });
});

// POST /vault/change-password — Update wrapped root key after password change
vaultRoutes.post("/change-password", zValidator("json", ChangePasswordSchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const body = c.req.valid("json");

  const [vault] = await db
    .select({ id: vaults.id })
    .from(vaults)
    .where(eq(vaults.userId, userId))
    .limit(1);
  if (!vault) {
    return c.json({ error: "Vault not found" }, 404);
  }

  await db
    .update(vaults)
    .set({
      wrappedRootKey: body.wrappedRootKey,
      kdfSalt: body.kdfSalt,
      kdfParams: body.kdfParams,
      updatedAt: new Date(),
    })
    .where(eq(vaults.userId, userId));

  await logAudit(db, { userId, eventType: "vault.password_change", result: "allowed" });

  return c.json({ ok: true });
});

// POST /vault/recovery/setup — Store recovery-wrapped root key
vaultRoutes.post("/recovery/setup", zValidator("json", RecoverySetupSchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const body = c.req.valid("json");

  await db
    .update(vaults)
    .set({ recoveryWrappedRootKey: body.recoveryWrappedRootKey, updatedAt: new Date() })
    .where(eq(vaults.userId, userId));

  return c.json({ ok: true });
});

// POST /vault/rotate-key — Batch update vault + item DEKs after root key rotation
vaultRoutes.post("/rotate-key", zValidator("json", RotateKeySchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const body = c.req.valid("json");

  const [vault] = await db.select().from(vaults).where(eq(vaults.userId, userId)).limit(1);
  if (!vault) {
    return c.json({ error: "Vault not found" }, 404);
  }

  // Update vault with new wrapped root key and increment key version
  await db
    .update(vaults)
    .set({
      wrappedRootKey: body.wrappedRootKey,
      recoveryWrappedRootKey: body.recoveryWrappedRootKey ?? vault.recoveryWrappedRootKey,
      keyVersion: vault.keyVersion + 1,
      updatedAt: new Date(),
    })
    .where(eq(vaults.userId, userId));

  // Update each item's encrypted_item_key with rekeyed DEK
  for (const [itemId, newEncryptedItemKey] of Object.entries(body.rekeyedItems)) {
    await db
      .update(items)
      .set({ encryptedItemKey: newEncryptedItemKey, updatedAt: new Date() })
      .where(eq(items.id, itemId));
  }

  await logAudit(db, {
    userId,
    eventType: "vault.key_rotate",
    result: "allowed",
    meta: { itemCount: Object.keys(body.rekeyedItems).length },
  });

  return c.json({ ok: true, keyVersion: vault.keyVersion + 1 });
});
