import {
  accessActions,
  accessOutcomes,
  deliveryModes,
  environments,
  principalTypes,
} from "@abadge/core";
import { index, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Append-only access log. No FK constraints — audit records must persist
 * even after credentials or agents are deleted.
 */
export const accessLog = pgTable(
  "access_log",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    credentialId: uuid("credential_id").notNull(),
    credentialName: text("credential_name").notNull(),
    agentName: text("agent_name").notNull(),
    action: text("action", { enum: accessActions }).notNull(),
    purpose: text("purpose"),
    ipAddress: text("ip_address"),
    principalType: text("principal_type", { enum: principalTypes }).default("agent"),
    requestedAction: text("requested_action"),
    deliveryMode: text("delivery_mode", { enum: deliveryModes }),
    destination: text("destination"),
    approvalId: text("approval_id"),
    sessionId: text("session_id"),
    environment: text("environment", { enum: environments }),
    connectorUsed: text("connector_used"),
    outcome: text("outcome", { enum: accessOutcomes }),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_access_log_credential_id_ts").on(t.credentialId, t.timestamp),
    index("idx_access_log_agent_id_ts").on(t.agentId, t.timestamp),
    index("idx_access_log_outcome").on(t.outcome),
  ],
);
