import { AGENT_KINDS, AGENT_LOCALITIES, PRINCIPAL_AUTH_METHODS } from "@abadge/core";
import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organization";

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind", { enum: AGENT_KINDS }).notNull(),
    locality: text("locality", { enum: AGENT_LOCALITIES }).notNull(),
    authMethod: text("auth_method", { enum: PRINCIPAL_AUTH_METHODS }).notNull(),
    secretHash: text("secret_hash"),
    secretPrefix: text("secret_prefix"),
    publicKey: text("public_key"),
    enabled: boolean("enabled").notNull().default(true),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agents_organization_id_idx").on(table.organizationId),
    index("agents_created_by_idx").on(table.createdBy),
    index("agents_secret_prefix_idx").on(table.secretPrefix),
  ],
);
