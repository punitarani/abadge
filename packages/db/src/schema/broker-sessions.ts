import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { apikey } from "./apikey";
import { user } from "./auth";

export const brokerSessions = pgTable(
  "broker_sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    agentId: text("agent_id")
      .notNull()
      .references(() => apikey.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").$type<string[]>(),
    allowedDeliveryModes: jsonb("allowed_delivery_modes").$type<string[]>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_broker_sessions_token_hash").on(t.tokenHash),
    index("idx_broker_sessions_agent_id").on(t.agentId),
    index("idx_broker_sessions_user_id").on(t.userId),
  ],
);
