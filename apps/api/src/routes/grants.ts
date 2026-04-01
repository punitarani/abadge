import { CreateGrantSchema } from "@abadge/core";
import { and, eq, or } from "@abadge/db";
import { grants, items, principals } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logAudit } from "../lib/audit";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const grantRoutes = new Hono<Env>();

grantRoutes.use("*", authMiddleware);

// POST /grants — Create grant
grantRoutes.post("/", zValidator("json", CreateGrantSchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const body = c.req.valid("json");

  // Verify principal belongs to user
  const [principal] = await db
    .select()
    .from(principals)
    .where(and(eq(principals.id, body.principalId), eq(principals.userId, userId)))
    .limit(1);

  if (!principal) return c.json({ error: "Principal not found" }, 404);

  // Verify item belongs to user
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, body.itemId), eq(items.userId, userId)))
    .limit(1);

  if (!item) return c.json({ error: "Item not found" }, 404);

  // Enforce capability matrix: remote principals cannot access ZK items
  if (principal.locality === "remote" && item.storageMode === "zero_knowledge") {
    return c.json({ error: "Remote principals cannot access zero-knowledge items" }, 400);
  }

  // Remote principals can only have reveal_plaintext on server_managed items
  if (principal.locality === "remote" && body.capability !== "reveal_plaintext") {
    return c.json({ error: "Remote principals can only have reveal_plaintext capability" }, 400);
  }

  const id = crypto.randomUUID();
  await db.insert(grants).values({
    id,
    principalId: body.principalId,
    itemId: body.itemId,
    capability: body.capability,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    grantedBy: userId,
  });

  await logAudit(db, {
    userId,
    principalId: body.principalId,
    itemId: body.itemId,
    eventType: "grant.create",
    result: "allowed",
    meta: { capability: body.capability },
  });

  return c.json({ id }, 201);
});

// GET /grants — List grants (filter by principalId or itemId)
grantRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const principalId = c.req.query("principalId");
  const itemId = c.req.query("itemId");

  // Get user's principal IDs for filtering
  const userPrincipals = await db
    .select({ id: principals.id })
    .from(principals)
    .where(eq(principals.userId, userId));

  const principalIds = userPrincipals.map((p) => p.id);
  if (principalIds.length === 0) return c.json([]);

  let result: (typeof grants.$inferSelect)[];
  if (principalId) {
    if (!principalIds.includes(principalId)) return c.json([]);
    result = await db.select().from(grants).where(eq(grants.principalId, principalId));
  } else if (itemId) {
    result = await db.select().from(grants).where(eq(grants.itemId, itemId));
  } else {
    result = await db
      .select()
      .from(grants)
      .where(or(...principalIds.map((pid) => eq(grants.principalId, pid))));
  }

  return c.json(
    result.map((g) => ({
      id: g.id,
      principalId: g.principalId,
      itemId: g.itemId,
      capability: g.capability,
      expiresAt: g.expiresAt?.toISOString() ?? null,
      grantedBy: g.grantedBy,
      createdAt: g.createdAt.toISOString(),
    })),
  );
});

// DELETE /grants/:id — Revoke grant
grantRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const grantId = c.req.param("id");

  // Verify the grant belongs to a principal owned by this user
  const [grant] = await db.select().from(grants).where(eq(grants.id, grantId)).limit(1);

  if (!grant) return c.json({ error: "Grant not found" }, 404);

  const [principal] = await db
    .select({ userId: principals.userId })
    .from(principals)
    .where(eq(principals.id, grant.principalId))
    .limit(1);

  if (!principal || principal.userId !== userId) {
    return c.json({ error: "Grant not found" }, 404);
  }

  await db.delete(grants).where(eq(grants.id, grantId));

  await logAudit(db, {
    userId,
    principalId: grant.principalId,
    itemId: grant.itemId,
    eventType: "grant.revoke",
    result: "allowed",
  });

  return c.json({ ok: true });
});
