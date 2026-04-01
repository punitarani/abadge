import type { Capability } from "@abadge/core";
import { CiphertextAccessSchema, MountAccessSchema, RevealAccessSchema } from "@abadge/core";
import { serverDecrypt } from "@abadge/crypto/server";
import { and, eq, isNull } from "@abadge/db";
import { grants, items } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getClientIp, logAudit } from "../lib/audit";
import { principalAuthMiddleware } from "../middleware/principal-auth";
import type { PrincipalEnv } from "../types";

export const accessRoutes = new Hono<PrincipalEnv>();

accessRoutes.use("*", principalAuthMiddleware);

async function checkGrant(
  db: Parameters<typeof logAudit>[0],
  principalId: string,
  itemId: string,
  capability: Capability,
): Promise<boolean> {
  const [grant] = await db
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.principalId, principalId),
        eq(grants.itemId, itemId),
        eq(grants.capability, capability),
      ),
    )
    .limit(1);

  if (!grant) return false;
  if (grant.expiresAt && grant.expiresAt < new Date()) return false;
  return true;
}

// POST /access/ciphertext — Get encrypted item (local principals, ZK items)
accessRoutes.post("/ciphertext", zValidator("json", CiphertextAccessSchema), async (c) => {
  const principalId = c.get("principalId");
  const principalUserId = c.get("principalUserId");
  const locality = c.get("principalLocality");
  const db = c.get("db");
  const ip = getClientIp(c);
  const { itemId } = c.req.valid("json");

  if (locality !== "local") {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType: "access.ciphertext",
      result: "denied",
      ipAddress: ip,
      meta: { reason: "remote principal cannot read ciphertext" },
    });
    return c.json({ error: "Remote principals cannot access ciphertext" }, 403);
  }

  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, principalUserId), isNull(items.deletedAt)))
    .limit(1);

  if (!item) {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType: "access.ciphertext",
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "Item not found" }, 404);
  }

  if (item.storageMode !== "zero_knowledge") {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType: "access.ciphertext",
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "Item is not zero-knowledge" }, 400);
  }

  const hasGrant = await checkGrant(db, principalId, itemId, "read_ciphertext");
  if (!hasGrant) {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType: "access.ciphertext",
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "No valid grant" }, 403);
  }

  await logAudit(db, {
    userId: principalUserId,
    principalId,
    itemId,
    eventType: "access.ciphertext",
    result: "allowed",
    ipAddress: ip,
  });

  return c.json({
    encryptedItemKey: item.encryptedItemKey,
    ciphertext: item.ciphertext,
    cryptoVersion: item.cryptoVersion,
  });
});

// POST /access/reveal — Get decrypted value (remote principals, server-managed items)
accessRoutes.post("/reveal", zValidator("json", RevealAccessSchema), async (c) => {
  const principalId = c.get("principalId");
  const principalUserId = c.get("principalUserId");
  const db = c.get("db");
  const ip = getClientIp(c);
  const { itemId } = c.req.valid("json");

  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, principalUserId), isNull(items.deletedAt)))
    .limit(1);

  if (!item) {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType: "access.reveal",
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "Item not found" }, 404);
  }

  if (item.storageMode !== "server_managed") {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType: "access.reveal",
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "Cannot reveal zero-knowledge items via API" }, 400);
  }

  const hasGrant = await checkGrant(db, principalId, itemId, "reveal_plaintext");
  if (!hasGrant) {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType: "access.reveal",
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "No valid grant" }, 403);
  }

  if (!item.serverCiphertext || !item.serverIv || item.serverKeyVersion == null) {
    return c.json({ error: "Item has no server-encrypted data" }, 500);
  }

  const decrypted = await serverDecrypt(
    { ciphertext: item.serverCiphertext, iv: item.serverIv, keyVersion: item.serverKeyVersion },
    c.env.ENCRYPTION_KEY,
  );

  const payload = JSON.parse(new TextDecoder().decode(decrypted));

  await logAudit(db, {
    userId: principalUserId,
    principalId,
    itemId,
    eventType: "access.reveal",
    result: "allowed",
    deliveryMode: "reveal",
    ipAddress: ip,
  });

  return c.json({ payload });
});

// POST /access/mount — Request mount metadata (local principals)
accessRoutes.post("/mount", zValidator("json", MountAccessSchema), async (c) => {
  const principalId = c.get("principalId");
  const principalUserId = c.get("principalUserId");
  const locality = c.get("principalLocality");
  const db = c.get("db");
  const ip = getClientIp(c);
  const { itemId, mountType } = c.req.valid("json");
  const eventType = `access.mount_${mountType}` as const;

  if (locality !== "local") {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType,
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "Remote principals cannot mount" }, 403);
  }

  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, itemId), eq(items.userId, principalUserId), isNull(items.deletedAt)))
    .limit(1);

  if (!item) {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType,
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "Item not found" }, 404);
  }

  const capability = mountType === "env" ? "mount_env" : "mount_file";
  const hasGrant = await checkGrant(db, principalId, itemId, capability);
  if (!hasGrant) {
    await logAudit(db, {
      userId: principalUserId,
      principalId,
      itemId,
      eventType,
      result: "denied",
      ipAddress: ip,
    });
    return c.json({ error: "No valid grant" }, 403);
  }

  await logAudit(db, {
    userId: principalUserId,
    principalId,
    itemId,
    eventType,
    result: "allowed",
    deliveryMode: `mount_${mountType}`,
    ipAddress: ip,
  });

  if (item.storageMode === "zero_knowledge") {
    return c.json({
      storageMode: item.storageMode,
      encryptedItemKey: item.encryptedItemKey,
      ciphertext: item.ciphertext,
      cryptoVersion: item.cryptoVersion,
    });
  }

  if (!item.serverCiphertext || !item.serverIv || item.serverKeyVersion == null) {
    return c.json({ error: "Item has no server-encrypted data" }, 500);
  }

  const decrypted = await serverDecrypt(
    { ciphertext: item.serverCiphertext, iv: item.serverIv, keyVersion: item.serverKeyVersion },
    c.env.ENCRYPTION_KEY,
  );

  return c.json({
    storageMode: item.storageMode,
    payload: JSON.parse(new TextDecoder().decode(decrypted)),
  });
});
