import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { items } from "./items";
import { principals } from "./principals";

export const capabilityEnum = [
  "read_ciphertext",
  "reveal_plaintext",
  "mount_env",
  "mount_file",
  "use_without_reveal",
] as const;

export const grants = pgTable(
  "grants",
  {
    id: text("id").primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => principals.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    capability: text("capability", { enum: capabilityEnum }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("grants_unique_idx").on(table.principalId, table.itemId, table.capability),
    index("grants_principal_id_idx").on(table.principalId),
    index("grants_item_id_idx").on(table.itemId),
  ],
);
