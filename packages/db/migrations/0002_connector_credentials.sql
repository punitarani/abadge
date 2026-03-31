-- credentials: add connector link columns for external vault sources
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "source_type" text DEFAULT 'native';--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "connector_id" text REFERENCES "connectors"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "external_ref" jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_credentials_connector_id" ON "credentials" USING btree ("connector_id");
