import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { user } from "./auth";

export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    // §AB-0043 — nullable + SET NULL: an orphaned agent (creator deleted) can still
    // exchange sessions, with userId null. Previously-issued sessions now survive
    // user-deletion (until their 15-min TTL) instead of being cascade-deleted.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_sessions_token_hash_idx").on(table.tokenHash),
    index("agent_sessions_agent_id_idx").on(table.agentId),
    index("agent_sessions_user_id_idx").on(table.userId),
    index("agent_sessions_expires_at_idx").on(table.expiresAt),
  ],
);
