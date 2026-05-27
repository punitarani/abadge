import { bigserial, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: text("organization_id").notNull(),
    // §AB-0043 — nullable: an orphaned agent (its creating user deleted, per
    // agents.created_by SET NULL) still acts and must still be logged, but has
    // no actor-user. The "every access is logged" invariant holds (the row is
    // written); only the actor-user is null for this case.
    userId: text("user_id"),
    agentId: text("agent_id"),
    itemId: text("item_id"),
    profileId: text("profile_id"),
    surface: text("surface"),
    eventType: text("event_type").notNull(),
    result: text("result").notNull(),
    deliveryMode: text("delivery_mode"),
    field: text("field"),
    purpose: text("purpose"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text("ip_address"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_organization_id_idx").on(table.organizationId),
    index("audit_logs_user_id_idx").on(table.userId),
    index("audit_logs_agent_id_idx").on(table.agentId),
    index("audit_logs_item_id_idx").on(table.itemId),
    index("audit_logs_profile_id_idx").on(table.profileId),
    index("audit_logs_occurred_at_idx").on(table.occurredAt),
  ],
);
