import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apikey } from "./apikey";
import { credentials } from "./credentials";

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
  },
  (t) => [primaryKey({ columns: [t.agentId, t.credentialId] })],
);
