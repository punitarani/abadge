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
    // §RM-PR1 — Optional caller-supplied identifier used for idempotent
    // provisioning of profiles from an external system. Nullable for backward
    // compat with profiles created before this column existed; required only
    // for API-created profiles in the upcoming v1 REST surface.
    externalId: text("external_id"),
    storageMode: text("storage_mode", { enum: STORAGE_MODES }).notNull(),
    wrappedRootKey: text("wrapped_root_key"),
    kdfSalt: text("kdf_salt"),
    kdfParams: jsonb("kdf_params"),
    recoveryWrappedRootKey: text("recovery_wrapped_root_key"),
    // §AB-0030 — per-profile server-managed DEK, wrapped under ENCRYPTION_KEY
    // (base64 iv ‖ AES-256-GCM(masterKey, DEK)). NULL until the profile's first
    // v3 server-managed write provisions it. Only server_managed profiles use it.
    serverWrappedDek: text("server_wrapped_dek"),
    // §AB-0031 — running count of AES-256-GCM encryptions performed under this
    // profile's DEK. Warn operators when approaching the 2^32 nonce-reuse bound;
    // threshold is 2^27 (~134 M) to give ample lead time before saturation.
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
    // §RM-PR1 — Partial unique index: enforce uniqueness only when externalId
    // is set, so multiple legacy profiles per org without an externalId remain
    // valid.
    uniqueIndex("profiles_org_external_id_idx")
      .on(table.organizationId, table.externalId)
      .where(sql`${table.externalId} IS NOT NULL`),
  ],
);
