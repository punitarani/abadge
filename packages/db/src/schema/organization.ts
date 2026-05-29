import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const organizations = organization;

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_member_organization_id").on(t.organizationId),
    index("idx_member_user_id").on(t.userId),
    // Looked up on essentially every authenticated request (org-role resolution):
    // `WHERE organization_id = ? AND user_id = ?`. The composite makes it an exact
    // probe instead of scan-by-user-then-filter-org. Left non-unique to avoid any
    // migration risk; the one-membership-per-(org,user) invariant can be enforced
    // separately after a duplicate check.
    index("idx_member_org_user").on(t.organizationId, t.userId),
  ],
);

export const members = member;

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email"),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedBy: text("used_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("idx_invitation_organization_id").on(t.organizationId),
    uniqueIndex("idx_invitation_token_hash").on(t.tokenHash),
  ],
);

export const invitations = invitation;
