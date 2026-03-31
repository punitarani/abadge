import { index, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apikey } from "./apikey";
import { credentials } from "./credentials";
import { policies } from "./policies";

export const agentCredentialPermissions = pgTable(
  "agent_credential_permissions",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => apikey.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    grantedBy: text("granted_by").notNull(),
    policyId: text("policy_id").references(() => policies.id, { onDelete: "set null" }),
    allowedDeliveryModes: jsonb("allowed_delivery_modes").$type<string[]>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.credentialId] }),
    index("idx_permissions_credential_id").on(t.credentialId),
  ],
);
