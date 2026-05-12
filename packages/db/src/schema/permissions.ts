import { CAPABILITIES } from "@abadge/core";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { user } from "./auth";
import { items } from "./items";
import { organization } from "./organization";
import { profiles } from "./profiles";

export const permissions = pgTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    // §RM-PR1 — A permission targets EITHER a single item or a whole profile,
    // never both. itemId is now nullable; the CHECK constraint below enforces
    // exactly-one-target. Profile-target permissions cascade-grant access to
    // every item under the profile.
    itemId: text("item_id").references(() => items.id, { onDelete: "cascade" }),
    profileId: text("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
    capability: text("capability", { enum: CAPABILITIES }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Existing uniqueness for item-target rows. Partial WHERE keeps NULL
    // itemId rows from colliding on the (agent, NULL, cap) tuple.
    uniqueIndex("permissions_unique_idx")
      .on(table.agentId, table.itemId, table.capability)
      .where(sql`${table.itemId} IS NOT NULL`),
    // §RM-PR1 — Uniqueness for profile-target rows: each (agent, profile, cap)
    // can be granted at most once.
    uniqueIndex("permissions_agent_profile_cap_idx")
      .on(table.agentId, table.profileId, table.capability)
      .where(sql`${table.profileId} IS NOT NULL`),
    index("permissions_organization_id_idx").on(table.organizationId),
    index("permissions_agent_id_idx").on(table.agentId),
    index("permissions_item_id_idx").on(table.itemId),
    index("permissions_profile_id_idx").on(table.profileId),
    // §RM-PR1 — Exactly one of (itemId, profileId) must be non-null. Both-set
    // and both-null are illegal at the storage layer.
    check(
      "permissions_exactly_one_target",
      sql`(${table.itemId} IS NOT NULL AND ${table.profileId} IS NULL)
       OR (${table.itemId} IS NULL AND ${table.profileId} IS NOT NULL)`,
    ),
  ],
);
