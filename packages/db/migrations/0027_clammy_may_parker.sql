CREATE TABLE "account_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"claim_token_hash" text NOT NULL,
	"email" text,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_claims" ADD CONSTRAINT "account_claims_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_claims" ADD CONSTRAINT "account_claims_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_claims_claim_token_hash_idx" ON "account_claims" USING btree ("claim_token_hash");--> statement-breakpoint
CREATE INDEX "account_claims_organization_id_idx" ON "account_claims" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "account_claims_user_id_idx" ON "account_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_claims_expires_at_idx" ON "account_claims" USING btree ("expires_at");