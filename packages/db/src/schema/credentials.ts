import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const credentialTypeEnum = [
  "api_key",
  "login",
  "token",
  "json_blob",
  "pii",
  "other",
] as const;

export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: credentialTypeEnum }).notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    iv: text("iv").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_credentials_user_id").on(t.userId)],
);
