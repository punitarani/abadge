-- v2: credential firewall and runtime access layer

-- credentials: new columns (all nullable or with defaults for backward compat)
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "owner_scope" text DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "environment" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "service" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "provider" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "project" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "tags" jsonb;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "sensitivity" text DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "allowed_delivery_modes" jsonb;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "allowed_destinations" jsonb;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "created_by" text;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "updated_by" text;--> statement-breakpoint

-- access_log: new columns (all nullable or with defaults)
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "principal_type" text DEFAULT 'agent';--> statement-breakpoint
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "requested_action" text;--> statement-breakpoint
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "delivery_mode" text;--> statement-breakpoint
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "destination" text;--> statement-breakpoint
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "approval_id" text;--> statement-breakpoint
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "session_id" text;--> statement-breakpoint
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "environment" text;--> statement-breakpoint
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "connector_used" text;--> statement-breakpoint
ALTER TABLE "access_log" ADD COLUMN IF NOT EXISTS "outcome" text;--> statement-breakpoint

-- agent_credential_permissions: new columns
ALTER TABLE "agent_credential_permissions" ADD COLUMN IF NOT EXISTS "policy_id" text;--> statement-breakpoint
ALTER TABLE "agent_credential_permissions" ADD COLUMN IF NOT EXISTS "allowed_delivery_modes" jsonb;--> statement-breakpoint
ALTER TABLE "agent_credential_permissions" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;--> statement-breakpoint

-- policies table
CREATE TABLE IF NOT EXISTS "policies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"credential_id" uuid,
	"user_id" text NOT NULL,
	"rules" jsonb NOT NULL,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- approvals table
CREATE TABLE IF NOT EXISTS "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"requester_id" text NOT NULL,
	"approver_id" text,
	"credential_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"delivery_mode" text NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- broker_sessions table
CREATE TABLE IF NOT EXISTS "broker_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scopes" jsonb,
	"allowed_delivery_modes" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broker_sessions_token_hash_unique" UNIQUE("token_hash")
);--> statement-breakpoint

-- connectors table
CREATE TABLE IF NOT EXISTS "connectors" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"encrypted_config" text,
	"config_iv" text,
	"enabled" boolean DEFAULT true,
	"last_sync" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- foreign keys for new tables
ALTER TABLE "policies" ADD CONSTRAINT "policies_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_sessions" ADD CONSTRAINT "broker_sessions_agent_id_apikey_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broker_sessions" ADD CONSTRAINT "broker_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors" ADD CONSTRAINT "connectors_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- foreign key for permissions -> policies
ALTER TABLE "agent_credential_permissions" ADD CONSTRAINT "agent_credential_permissions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- indexes for new tables
CREATE INDEX IF NOT EXISTS "idx_policies_user_id" ON "policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_policies_credential_id" ON "policies" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approvals_status" ON "approvals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approvals_credential_id" ON "approvals" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_approvals_agent_id" ON "approvals" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_broker_sessions_token_hash" ON "broker_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_broker_sessions_agent_id" ON "broker_sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_broker_sessions_user_id" ON "broker_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_connectors_user_id" ON "connectors" USING btree ("user_id");
