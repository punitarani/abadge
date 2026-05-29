import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organization";

/**
 * Personal user API keys (prefix `abu_`). A long-lived credential bound to a
 * (user, org) pair that authenticates the management surface only — it resolves
 * to a session identity, never an agent identity, so it can never reach the
 * agent-gated `access.*` surface (no secret reveal/mount).
 *
 * Like `agents`, this table is read **pre-org-context** during authentication
 * (looked up by `secretPrefix` before any `app.current_org` GUC is set), so it
 * MUST remain RLS-exempt — it is deliberately NOT in the scoped DAL's
 * `TENANT_TABLES`. All access goes through the plain executor with explicit
 * `organizationId` / `userId` filters (same pattern as `agentSessions`).
 *
 * Unlike `agents.createdBy` (SET NULL — an agent's lifecycle follows its org),
 * both FKs cascade: a personal key has no reason to outlive its user or its org.
 */
export const userApiKeys = pgTable(
  "user_api_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // SHA-256 hash of the full `abu_…` token; the plaintext is never stored.
    secretHash: text("secret_hash").notNull(),
    // First 8 chars of the token, for the candidate-prefix auth lookup + display.
    secretPrefix: text("secret_prefix").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // Nullable = non-expiring (until revoked).
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("user_api_keys_secret_prefix_idx").on(table.secretPrefix),
    index("user_api_keys_user_id_idx").on(table.userId),
    index("user_api_keys_organization_id_idx").on(table.organizationId),
  ],
);
