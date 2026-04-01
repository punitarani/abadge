import { bigserial, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id").notNull(),
    principalId: text("principal_id"),
    itemId: text("item_id"),
    eventType: text("event_type").notNull(),
    result: text("result").notNull(),
    deliveryMode: text("delivery_mode"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text("ip_address"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_user_id_idx").on(table.userId),
    index("audit_log_principal_id_idx").on(table.principalId),
    index("audit_log_item_id_idx").on(table.itemId),
    index("audit_log_occurred_at_idx").on(table.occurredAt),
  ],
);
