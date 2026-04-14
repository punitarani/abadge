import { ITEM_KINDS, STORAGE_MODES } from "@abadge/core";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organization";
import { profiles } from "./profiles";
import { vaults } from "./vaults";

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    vaultId: text("vault_id").references(() => vaults.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    kind: text("kind", { enum: ITEM_KINDS }),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    storageMode: text("storage_mode", { enum: STORAGE_MODES }).notNull(),

    // ZK fields (null for server_managed)
    encryptedItemKey: text("encrypted_item_key"),
    keyNonce: text("key_nonce"),
    ciphertext: text("ciphertext"),
    contentNonce: text("content_nonce"),

    // Server-managed fields (null for zero_knowledge)
    serverCiphertext: text("server_ciphertext"),
    serverIv: text("server_iv"),
    serverKeyVersion: integer("server_key_version"),

    // Common
    cryptoVersion: integer("crypto_version").notNull().default(1),
    contentVersion: integer("content_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("items_organization_id_idx").on(table.organizationId),
    index("items_profile_id_idx").on(table.profileId),
    index("items_user_id_idx").on(table.userId),
    index("items_vault_id_idx").on(table.vaultId),
  ],
);
