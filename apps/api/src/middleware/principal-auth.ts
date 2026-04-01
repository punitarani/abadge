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

  if (principal?.secretHash) {
    const valid = await verifyApiKey(token, principal.secretHash);
    if (valid) {
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
      return;
    }
  }

  // Fallback for migrated remote agents that still authenticate via Better Auth API keys.
  const { createAuth } = await import("@abadge/auth");
  const auth = createAuth(db, {
    API_URL: c.env.API_URL,
    APP_URL: c.env.APP_URL,
    BETTER_AUTH_URL: c.env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: c.env.BETTER_AUTH_SECRET,
    GOOGLE_CLIENT_ID: c.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: c.env.GOOGLE_CLIENT_SECRET,
    GITHUB_CLIENT_ID: c.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: c.env.GITHUB_CLIENT_SECRET,
  });

  const result = await auth.api.verifyApiKey({
    body: { key: token },
  });

  if (!result.valid || !result.key) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  const legacyPrincipalId = result.key.id as string | undefined;
  const legacyUserId = result.key.referenceId as string | undefined;
  if (!legacyPrincipalId || !legacyUserId) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  if (
    principal &&
    principal.id === legacyPrincipalId &&
    (!principal.enabled || principal.revokedAt)
  ) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  db.update(principals)
    .set({ lastUsedAt: new Date() })
    .where(eq(principals.id, legacyPrincipalId))
    .execute();

  c.set("principalId", legacyPrincipalId);
  c.set("principalUserId", legacyUserId);
  c.set("principalLocality", "remote");
  c.set("db", db);
  await next();
});
