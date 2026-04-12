import { STORAGE_MODES } from "@abadge/core";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./organization";

export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    storageMode: text("storage_mode", { enum: STORAGE_MODES }).notNull(),
    wrappedRootKey: text("wrapped_root_key"),
    kdfSalt: text("kdf_salt"),
    kdfParams: jsonb("kdf_params"),
    recoveryWrappedRootKey: text("recovery_wrapped_root_key"),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("profiles_organization_id_idx").on(table.organizationId),
    uniqueIndex("profiles_name_idx").on(table.organizationId, table.name),
  ],
);
