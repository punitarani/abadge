-- v2 features: connector credentials, auto-grants, agent groups, org-scoped credentials

-- credentials: add connector link columns for external vault sources
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "source_type" text DEFAULT 'native';--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "connector_id" text REFERENCES "connectors"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "external_ref" jsonb;--> statement-breakpoint
ALTER TABLE "credentials" ADD COLUMN IF NOT EXISTS "org_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_credentials_connector_id" ON "credentials" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_credentials_org_id" ON "credentials" USING btree ("org_id");--> statement-breakpoint

-- auto_grants table
CREATE TABLE IF NOT EXISTS "auto_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"match_environment" text,
	"match_tags" jsonb,
	"match_type" text,
	"match_service" text,
	"match_sensitivity" text,
	"policy_id" text,
	"allowed_delivery_modes" jsonb,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "auto_grants" ADD CONSTRAINT "auto_grants_agent_id_apikey_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_grants" ADD CONSTRAINT "auto_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_grants" ADD CONSTRAINT "auto_grants_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auto_grants_agent_id" ON "auto_grants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auto_grants_user_id" ON "auto_grants" USING btree ("user_id");--> statement-breakpoint

-- agent_groups table
CREATE TABLE IF NOT EXISTS "agent_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- agent_group_members table
CREATE TABLE IF NOT EXISTS "agent_group_members" (
	"group_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_group_members_pkey" PRIMARY KEY("group_id","agent_id")
);--> statement-breakpoint
ALTER TABLE "agent_groups" ADD CONSTRAINT "agent_groups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_group_members" ADD CONSTRAINT "agent_group_members_group_id_agent_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."agent_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_group_members" ADD CONSTRAINT "agent_group_members_agent_id_apikey_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_groups_user_id" ON "agent_groups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_group_members_agent_id" ON "agent_group_members" USING btree ("agent_id");
