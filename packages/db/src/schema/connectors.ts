import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const connectorTypeEnum = [
  "native",
  "onepassword",
  "aws_secrets_manager",
  "hashicorp_vault",
] as const;

export const connectors = pgTable("connectors", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type", { enum: connectorTypeEnum }).notNull(),
  encryptedConfig: text("encrypted_config").notNull(),
  iv: text("iv").notNull(),
  metadata: jsonb("metadata").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
