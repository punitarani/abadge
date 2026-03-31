ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "org_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_credentials_org_id" ON "credentials" USING btree ("org_id");
