import { API_KEY_PREFIX, CreatePrincipalSchema, localityForKind } from "@abadge/core";
import { generateApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull } from "@abadge/db";
import { principals } from "@abadge/db/schema";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { logAudit } from "../lib/audit";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "../types";

export const principalRoutes = new Hono<Env>();

principalRoutes.use("*", authMiddleware);

// POST /principals — Register a new principal
principalRoutes.post("/", zValidator("json", CreatePrincipalSchema), async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const body = c.req.valid("json");

  const locality = localityForKind(body.kind);
  const prefix = API_KEY_PREFIX[locality];
  const { key, hash, prefix: keyPrefix } = await generateApiKey(prefix);

  const id = crypto.randomUUID();
  await db.insert(principals).values({
    id,
    userId,
    kind: body.kind,
    locality,
    name: body.name,
    secretHash: hash,
    secretPrefix: keyPrefix,
    metadata: body.metadata,
  });

  await logAudit(db, { userId, principalId: id, eventType: "principal.create", result: "allowed" });

  return c.json(
    {
      principal: {
        id,
        userId,
        kind: body.kind,
        locality,
        name: body.name,
        secretPrefix: keyPrefix,
        enabled: true,
        revokedAt: null,
        lastUsedAt: null,
        metadata: body.metadata,
        createdAt: new Date().toISOString(),
      },
      secret: key,
    },
    201,
  );
});

// GET /principals — List principals
principalRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");

  const result = await db.select().from(principals).where(eq(principals.userId, userId));

  return c.json(
    result.map((p) => ({
      id: p.id,
      userId: p.userId,
      kind: p.kind,
      locality: p.locality,
      name: p.name,
      secretPrefix: p.secretPrefix,
      enabled: p.enabled,
      revokedAt: p.revokedAt?.toISOString() ?? null,
      lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
      metadata: p.metadata,
      createdAt: p.createdAt.toISOString(),
    })),
  );
});

// GET /principals/:id
principalRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const id = c.req.param("id");

  const [p] = await db
    .select()
    .from(principals)
    .where(and(eq(principals.id, id), eq(principals.userId, userId)))
    .limit(1);

  if (!p) return c.json({ error: "Principal not found" }, 404);

  return c.json({
    id: p.id,
    userId: p.userId,
    kind: p.kind,
    locality: p.locality,
    name: p.name,
    secretPrefix: p.secretPrefix,
    enabled: p.enabled,
    revokedAt: p.revokedAt?.toISOString() ?? null,
    lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
    metadata: p.metadata,
    createdAt: p.createdAt.toISOString(),
  });
});

// POST /principals/:id/rotate — Rotate API key
principalRoutes.post("/:id/rotate", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const id = c.req.param("id");

  const [p] = await db
    .select()
    .from(principals)
    .where(and(eq(principals.id, id), eq(principals.userId, userId), isNull(principals.revokedAt)))
    .limit(1);

  if (!p) return c.json({ error: "Principal not found" }, 404);

  const prefix = API_KEY_PREFIX[p.locality as "local" | "remote"];
  const { key, hash, prefix: keyPrefix } = await generateApiKey(prefix);

  await db
    .update(principals)
    .set({ secretHash: hash, secretPrefix: keyPrefix })
    .where(eq(principals.id, id));

  await logAudit(db, { userId, principalId: id, eventType: "principal.rotate", result: "allowed" });

  return c.json({ secret: key, secretPrefix: keyPrefix });
});

// POST /principals/:id/revoke — Revoke principal
principalRoutes.post("/:id/revoke", async (c) => {
  const userId = c.get("userId");
  const db = c.get("db");
  const id = c.req.param("id");

  const [p] = await db
    .select({ id: principals.id })
    .from(principals)
    .where(and(eq(principals.id, id), eq(principals.userId, userId)))
    .limit(1);

  if (!p) return c.json({ error: "Principal not found" }, 404);

  await db
    .update(principals)
    .set({ revokedAt: new Date(), enabled: false })
    .where(eq(principals.id, id));

  await logAudit(db, { userId, principalId: id, eventType: "principal.revoke", result: "allowed" });

  return c.json({ ok: true });
});
