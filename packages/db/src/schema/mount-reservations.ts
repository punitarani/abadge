import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { items } from "./items";

/**
 * §RM-PR2 — Short-lived `use`-action mount handles.
 *
 * `access.use` and `access.useProfile` mint an opaque `mountId` (prefix
 * `mnt_`) that the local daemon exchanges for the actual decrypted material.
 * The reservation row records which (agent, item, delivery) pair the handle
 * is bound to and when it expires (default TTL 5 minutes). `consumedAt`
 * lets the daemon mark a handle as exchanged so it cannot be replayed.
 */
export const mountReservations = pgTable(
  "mount_reservations",
  {
    id: text("id").primaryKey(),
    mountId: text("mount_id").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    delivery: text("delivery", { enum: ["env", "file"] }).notNull(),
    field: text("field"),
    envVarName: text("env_var_name"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("mount_reservations_mount_id_idx").on(table.mountId),
    index("mount_reservations_item_id_idx").on(table.itemId),
    index("mount_reservations_agent_id_idx").on(table.agentId),
    index("mount_reservations_expires_at_idx").on(table.expiresAt),
  ],
);
