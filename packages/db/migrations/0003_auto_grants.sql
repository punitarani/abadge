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
);
--> statement-breakpoint
ALTER TABLE "auto_grants" ADD CONSTRAINT "auto_grants_agent_id_apikey_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "auto_grants" ADD CONSTRAINT "auto_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "auto_grants" ADD CONSTRAINT "auto_grants_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auto_grants_agent_id" ON "auto_grants" USING btree ("agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_auto_grants_user_id" ON "auto_grants" USING btree ("user_id");
