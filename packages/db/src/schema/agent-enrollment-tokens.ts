import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { user } from "./auth";

export const agentEnrollmentTokens = pgTable(
  "agent_enrollment_tokens",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    // Nullable + SET NULL: enrollment for an orphaned agent has no owning user.
    // createdBy stays NOT NULL — the insert always supplies the acting user, and
    // these tokens are 10-min ephemeral, so cascading a deleted issuer is harmless.
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_enrollment_tokens_token_hash_idx").on(table.tokenHash),
    index("agent_enrollment_tokens_agent_id_idx").on(table.agentId),
    index("agent_enrollment_tokens_user_id_idx").on(table.userId),
  ],
);
