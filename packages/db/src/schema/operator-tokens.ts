import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

type OperatorTokenScope =
  | "items:read"
  | "items:write"
  | "agents:read"
  | "agents:write"
  | "permissions:read"
  | "permissions:write"
  | "audit:read"
  | "vault:read"
  | "vault:write";

export const operatorTokens = pgTable(
  "operator_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    scopes: jsonb("scopes").$type<OperatorTokenScope[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("operator_tokens_token_hash_idx").on(table.tokenHash),
    index("operator_tokens_user_id_idx").on(table.userId),
    index("operator_tokens_token_prefix_idx").on(table.tokenPrefix),
    index("operator_tokens_expires_at_idx").on(table.expiresAt),
  ],
);
