import { ITEM_KINDS, STORAGE_MODES } from "@abadge/core";
import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organization";
import { profiles } from "./profiles";

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    profileId: text("profile_id").references(() => profiles.id, { onDelete: "set null" }),
    // §RM-PR1 — audit metadata, not ownership. Items belong to the
    // organization (organizationId is the isolation boundary), not to a user.
    // `createdBy` records who *created* the row for traceability, and is
    // nullable so deleting the user does not require also deleting the item.
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    kind: text("kind", { enum: ITEM_KINDS }),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    storageMode: text("storage_mode", { enum: STORAGE_MODES }).notNull(),

    // ZK fields (null for server_managed)
    encryptedItemKey: text("encrypted_item_key"),
    ciphertext: text("ciphertext"),
    contentNonce: text("content_nonce"),

    // Server-managed fields (null for zero_knowledge)
    serverCiphertext: text("server_ciphertext"),
    serverIv: text("server_iv"),
    // Doubles as the AAD-epoch marker (§W1S7-002):
    //   1     → legacy no-AAD ciphertext (pre-§W1S7-002).
    //   >= 2  → AAD-bound (org, profile, item, keyVersion) — see
    //           `buildServerAad` in @abadge/crypto/shared.
    // Future AES master-key rotations bump this further.
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
    index("items_created_by_idx").on(table.createdBy),
  ],
);
