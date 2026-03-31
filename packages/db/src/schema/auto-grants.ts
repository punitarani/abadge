import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { apikey } from "./apikey";
import { user } from "./auth";
import { policies } from "./policies";

export const autoGrants = pgTable(
  "auto_grants",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => apikey.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    matchEnvironment: text("match_environment"),
    matchTags: jsonb("match_tags").$type<string[]>(),
    matchType: text("match_type"),
    matchService: text("match_service"),
    matchSensitivity: text("match_sensitivity"),
    policyId: text("policy_id").references(() => policies.id, { onDelete: "set null" }),
    allowedDeliveryModes: jsonb("allowed_delivery_modes").$type<string[]>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_auto_grants_agent_id").on(t.agentId),
    index("idx_auto_grants_user_id").on(t.userId),
  ],
);
