import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents";

export const agentSessionChallenges = pgTable(
  "agent_session_challenges",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    challengeHash: text("challenge_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agent_session_challenges_hash_idx").on(table.challengeHash),
    index("agent_session_challenges_agent_id_idx").on(table.agentId),
    // The opportunistic GC (createChallenge) runs `DELETE … WHERE expires_at < ?`
    // on every challenge creation; without this index it seq-scans the table.
    index("agent_session_challenges_expires_at_idx").on(table.expiresAt),
  ],
);
