import { AGENT_AUTH_METHODS, AGENT_KINDS, AGENT_LOCALITIES } from "@abadge/core";
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
    // Nullable + SET NULL so an agent's lifecycle follows the org, not its
    // creating user: deleting the user orphans (does not delete) the agent. An
    // orphaned agent keeps working; its audit rows carry a null actor-user (see
    // audit_logs.user_id).
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind", { enum: AGENT_KINDS }).notNull(),
    locality: text("locality", { enum: AGENT_LOCALITIES }).notNull(),
    authMethod: text("auth_method", { enum: AGENT_AUTH_METHODS }).notNull(),
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
  ],
);
