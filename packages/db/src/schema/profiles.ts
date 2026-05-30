import { STORAGE_MODES } from "@abadge/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
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
    // Optional caller-supplied identifier for idempotent provisioning of
    // profiles from an external system. Nullable: a profile need not carry one.
    externalId: text("external_id"),
    storageMode: text("storage_mode", { enum: STORAGE_MODES }).notNull(),
    wrappedRootKey: text("wrapped_root_key"),
    kdfSalt: text("kdf_salt"),
    kdfParams: jsonb("kdf_params"),
    recoveryWrappedRootKey: text("recovery_wrapped_root_key"),
    // Per-profile server-managed DEK, wrapped under ENCRYPTION_KEY
    // (base64 iv ‖ AES-256-GCM(masterKey, DEK)). NULL until the profile's first
    // server-managed write provisions it. Only server_managed profiles use it.
    serverWrappedDek: text("server_wrapped_dek"),
    // Running count of AES-256-GCM encryptions performed under this profile's
    // DEK. Warn operators when approaching the 2^32 nonce-reuse bound; threshold
    // is 2^27 (~134 M) to give ample lead time before saturation.
    serverEncryptionCount: bigint("server_encryption_count", { mode: "number" })
      .notNull()
      .default(0),
    keyVersion: integer("key_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("profiles_organization_id_idx").on(table.organizationId),
    uniqueIndex("profiles_name_idx").on(table.organizationId, table.name),
    // Partial unique index: enforce externalId uniqueness per org only when it
    // is set, so multiple profiles without an externalId can coexist.
    uniqueIndex("profiles_org_external_id_idx")
      .on(table.organizationId, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
  ],
);
