import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const vaults = pgTable(
  "vaults",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    wrappedRootKey: text("wrapped_root_key").notNull(),
    kdfSalt: text("kdf_salt").notNull(),
    kdfParams: jsonb("kdf_params").notNull(),
    recoveryWrappedRootKey: text("recovery_wrapped_root_key"),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("vaults_user_id_idx").on(table.userId)],
);
