import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Approval requests for credential access. No FK constraints on requesterId/approverId —
 * these reference agents or users that may be deleted, and approval records should persist.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    requesterId: text("requester_id").notNull(),
    approverId: text("approver_id"),
    credentialId: uuid("credential_id").notNull(),
    agentId: text("agent_id").notNull(),
    status: text("status", {
      enum: ["pending", "approved", "denied", "expired"],
    })
      .default("pending")
      .notNull(),
    deliveryMode: text("delivery_mode").notNull(),
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_approvals_status").on(t.status),
    index("idx_approvals_credential_id").on(t.credentialId),
    index("idx_approvals_agent_cred_status").on(t.agentId, t.credentialId, t.status),
  ],
);
