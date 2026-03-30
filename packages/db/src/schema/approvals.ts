import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const approvalStatusEnum = ["pending", "approved", "denied", "expired"] as const;

/**
 * Approval requests for agent credential access.
 * No FK constraints — like access_log, records must persist
 * even after credentials or agents are deleted.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requesterId: text("requester_id").notNull(),
    approverId: text("approver_id"),
    credentialId: uuid("credential_id").notNull(),
    agentId: text("agent_id").notNull(),
    status: text("status", { enum: approvalStatusEnum }).default("pending").notNull(),
    deliveryMode: text("delivery_mode").notNull(),
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_approvals_status").on(t.status),
    index("idx_approvals_credential_id").on(t.credentialId),
    index("idx_approvals_agent_id").on(t.agentId),
  ],
);
