import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const principalKindEnum = ["device", "local_cli", "local_mcp", "remote_agent"] as const;
export const principalLocalityEnum = ["local", "remote"] as const;

export const principals = pgTable(
  "principals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: principalKindEnum }).notNull(),
    locality: text("locality", { enum: principalLocalityEnum }).notNull(),
    name: text("name").notNull(),
    secretHash: text("secret_hash"),
    secretPrefix: text("secret_prefix"),
    publicKey: text("public_key"),
    enabled: boolean("enabled").notNull().default(true),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("principals_user_id_idx").on(table.userId),
    index("principals_secret_prefix_idx").on(table.secretPrefix),
  ],
);
