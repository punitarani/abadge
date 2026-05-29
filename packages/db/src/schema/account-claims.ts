import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { organization } from "./organization";

/**
 * auth.md anonymous-registration claim records. One row per `POST /agent/auth`:
 * it links the unclaimed personal account (the placeholder `user` + its org) to
 * a single-use `clm_` claim token, and tracks the email-OTP ceremony that binds
 * a real human owner.
 *
 * RLS-exempt (looked up by hashed token pre-org-context, like `user_api_keys`).
 * Both FKs cascade so the record never outlives its account; unclaimed-expired
 * rows are GC'd opportunistically (which also drops the placeholder account).
 */
export const accountClaims = pgTable(
  "account_claims",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The placeholder (unclaimed) user that owns the personal account until claimed.
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // SHA-256 of the `clm_` token returned to the agent at registration.
    claimTokenHash: text("claim_token_hash").notNull(),
    // Set at POST /agent/auth/claim (the human's email the OTP is sent to).
    email: text("email"),
    // SHA-256 of the 6-digit OTP; plaintext only ever lives in the email.
    otpHash: text("otp_hash"),
    otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
    otpAttempts: integer("otp_attempts").notNull().default(0),
    // pending → otp_sent → claimed
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("account_claims_claim_token_hash_idx").on(table.claimTokenHash),
    index("account_claims_organization_id_idx").on(table.organizationId),
    index("account_claims_user_id_idx").on(table.userId),
    index("account_claims_expires_at_idx").on(table.expiresAt),
  ],
);
