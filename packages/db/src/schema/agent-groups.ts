import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { apikey } from "./apikey";
import { user } from "./auth";

export const agentGroups = pgTable(
  "agent_groups",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_agent_groups_user_id").on(t.userId)],
);

export const agentGroupMembers = pgTable(
  "agent_group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => agentGroups.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => apikey.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.agentId] }),
    index("idx_agent_group_members_agent_id").on(t.agentId),
  ],
);
