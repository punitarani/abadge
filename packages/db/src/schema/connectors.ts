import { connectorTypes } from "@abadge/core";
import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const connectors = pgTable(
  "connectors",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: connectorTypes }).notNull(),
    encryptedConfig: text("encrypted_config"),
    configIv: text("config_iv"),
    enabled: boolean("enabled").default(true),
    lastSync: timestamp("last_sync", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_connectors_user_id").on(t.userId)],
);
