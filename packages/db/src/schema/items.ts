import { ITEM_KINDS, STORAGE_MODES } from "@abadge/core";
import { sql } from "drizzle-orm";
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
    // Audit metadata, not ownership. Items belong to the organization
    // (organizationId is the isolation boundary), not to a user. `createdBy`
    // records who created the row for traceability, and is nullable so deleting
    // the user orphans the item rather than deleting it.
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    kind: text("kind", { enum: ITEM_KINDS }),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    storageMode: text("storage_mode", { enum: STORAGE_MODES }).notNull(),

    // ZK fields (null for server_managed). The XChaCha20-Poly1305 content
    // nonce is prepended into `ciphertext` (first 24 bytes), not a column —
    // see encryptItem/decryptItem in @abadge/crypto/src/client/items.ts.
    encryptedItemKey: text("encrypted_item_key"),
    ciphertext: text("ciphertext"),

    // Server-managed fields (null for zero_knowledge)
    serverCiphertext: text("server_ciphertext"),
    serverIv: text("server_iv"),
    // Doubles as the AAD-epoch marker:
    //   1     → no-AAD ciphertext.
    //   >= 2  → AAD-bound (org, profile, item, keyVersion) — see
    //           `buildServerAad` in @abadge/crypto/shared.
    // AES master-key rotations bump this further.
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
    // Serve the keyset list directly: `WHERE organization_id = ?
    // AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`. Without this the
    // planner seq-scans the org's items + top-N sorts. Columns are plain ASC on
    // purpose: the query orders DESC (Postgres default NULLS FIRST), and Postgres
    // scans an ASC index BACKWARD to produce exactly DESC NULLS FIRST — whereas a
    // `DESC NULLS LAST` index (drizzle's `.desc()` default) would NOT match the
    // query's pathkey and the planner would fall back to a sort.
    index("items_org_created_at_id_active_idx")
      .on(table.organizationId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} is null`),
  ],
);
