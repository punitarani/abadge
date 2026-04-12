import { CAPABILITIES } from "@abadge/core";
import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { user } from "./auth";
import { items } from "./items";
import { organization } from "./organization";

export const permissions = pgTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    capability: text("capability", { enum: CAPABILITIES }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("permissions_unique_idx").on(table.agentId, table.itemId, table.capability),
    index("permissions_organization_id_idx").on(table.organizationId),
    index("permissions_agent_id_idx").on(table.agentId),
    index("permissions_item_id_idx").on(table.itemId),
  ],
);
