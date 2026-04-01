import { verifyApiKey } from "@abadge/crypto/shared";
import { and, eq, isNull } from "@abadge/db";
import { principals } from "@abadge/db/schema";
import { createMiddleware } from "hono/factory";
import { getConnectionString, getDb } from "../lib/db";
import type { PrincipalEnv } from "../types";

/**
 * Authenticate a principal via Bearer token (API key).
 * Looks up by prefix, then constant-time verifies the hash.
 */
export const principalAuthMiddleware = createMiddleware<PrincipalEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing Bearer token" }, 401);
  }

  const token = authHeader.slice(7);
  const prefix = token.slice(0, 8);

  const db = getDb(getConnectionString(c.env));

  const [principal] = await db
    .select()
    .from(principals)
    .where(
      and(
        eq(principals.secretPrefix, prefix),
        eq(principals.enabled, true),
        isNull(principals.revokedAt),
      ),
    )
    .limit(1);

  if (!principal?.secretHash) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  const valid = await verifyApiKey(token, principal.secretHash);
  if (!valid) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  // Update last used timestamp (fire-and-forget)
  db.update(principals)
    .set({ lastUsedAt: new Date() })
    .where(eq(principals.id, principal.id))
    .execute();

  c.set("principalId", principal.id);
  c.set("principalUserId", principal.userId);
  c.set("principalLocality", principal.locality);
  c.set("db", db);
  await next();
});
