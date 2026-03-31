import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { credentials } from "./credentials";

export const policies = pgTable(
  "policies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    credentialId: uuid("credential_id").references(() => credentials.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rules: jsonb("rules").notNull().$type<Record<string, unknown>[]>(),
    enabled: boolean("enabled").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_policies_user_id").on(t.userId),
    index("idx_policies_credential_id").on(t.credentialId),
  ],
);
