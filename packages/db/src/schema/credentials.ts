import type { ExternalRef } from "@abadge/core";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { connectors } from "./connectors";

export const credentialTypeEnum = [
  "api_key",
  "login",
  "token",
  "json_blob",
  "oauth_client",
  "service_account_json",
  "cookie_session",
  "pii",
  "other",
] as const;

export const ownerScopeEnum = ["user", "org", "system"] as const;

export const environmentEnum = ["dev", "staging", "prod"] as const;

export const sensitivityEnum = ["low", "medium", "high", "critical"] as const;

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
    ownerScope: text("owner_scope", { enum: ownerScopeEnum }).default("user"),
    environment: text("environment", { enum: environmentEnum }),
    service: text("service"),
    provider: text("provider"),
    project: text("project"),
    tags: jsonb("tags").$type<string[]>(),
    sensitivity: text("sensitivity", { enum: sensitivityEnum }).default("medium"),
    allowedDeliveryModes: jsonb("allowed_delivery_modes").$type<string[]>(),
    allowedDestinations: jsonb("allowed_destinations").$type<string[]>(),
    sourceType: text("source_type").default("native"),
    connectorId: text("connector_id").references(() => connectors.id, { onDelete: "set null" }),
    externalRef: jsonb("external_ref").$type<ExternalRef>(),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    orgId: text("org_id"),
  },
  (t) => [
    index("idx_credentials_user_id").on(t.userId),
    index("idx_credentials_connector_id").on(t.connectorId),
    index("idx_credentials_org_id").on(t.orgId),
  ],
);
