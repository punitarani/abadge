-- v3: zero-knowledge vault architecture rewrite
-- Drops all v1/v2 credential-firewall tables and creates the new ZK vault schema.
-- Auth tables (user, account, session, verification) and org tables are unchanged.

-- Drop v2 feature tables (0002)
DROP TABLE IF EXISTS "agent_group_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "agent_groups" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "auto_grants" CASCADE;--> statement-breakpoint

-- Drop v2 credential-firewall tables (0001)
DROP TABLE IF EXISTS "connectors" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "broker_sessions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "approvals" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "policies" CASCADE;--> statement-breakpoint

-- Drop v1 tables (0000)
DROP TABLE IF EXISTS "agent_credential_permissions" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "credentials" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "access_log" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "apikey" CASCADE;--> statement-breakpoint

-- Create new ZK vault tables
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"principal_id" text,
	"item_id" text,
	"event_type" text NOT NULL,
	"result" text NOT NULL,
	"delivery_mode" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "grants" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"item_id" text NOT NULL,
	"capability" text NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vault_id" text,
	"storage_mode" text NOT NULL,
	"encrypted_item_key" text,
	"key_nonce" text,
	"ciphertext" text,
	"content_nonce" text,
	"server_ciphertext" text,
	"server_iv" text,
	"server_key_version" integer,
	"crypto_version" integer DEFAULT 1 NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);--> statement-breakpoint
CREATE TABLE "principals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"locality" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text,
	"secret_prefix" text,
	"public_key" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wrapped_root_key" text NOT NULL,
	"kdf_salt" text NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"recovery_wrapped_root_key" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Foreign keys for new tables
ALTER TABLE "grants" ADD CONSTRAINT "grants_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Indexes for new tables
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_principal_id_idx" ON "audit_log" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "audit_log_item_id_idx" ON "audit_log" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_unique_idx" ON "grants" USING btree ("principal_id","item_id","capability");--> statement-breakpoint
CREATE INDEX "grants_principal_id_idx" ON "grants" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX "grants_item_id_idx" ON "grants" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_user_id_idx" ON "items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "items_vault_id_idx" ON "items" USING btree ("vault_id");--> statement-breakpoint
CREATE INDEX "principals_user_id_idx" ON "principals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "principals_secret_prefix_idx" ON "principals" USING btree ("secret_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "vaults_user_id_idx" ON "vaults" USING btree ("user_id");
