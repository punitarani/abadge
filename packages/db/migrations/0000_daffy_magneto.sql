CREATE TABLE "apikey" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"reference_id" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "access_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"credential_id" uuid NOT NULL,
	"credential_name" text NOT NULL,
	"agent_name" text NOT NULL,
	"action" text NOT NULL,
	"purpose" text,
	"ip_address" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"iv" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent_credential_permissions" (
	"agent_id" text NOT NULL,
	"credential_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text NOT NULL,
	CONSTRAINT "agent_credential_permissions_agent_id_credential_id_pk" PRIMARY KEY("agent_id","credential_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credential_permissions" ADD CONSTRAINT "agent_credential_permissions_agent_id_apikey_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_credential_permissions" ADD CONSTRAINT "agent_credential_permissions_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_apikey_config_id" ON "apikey" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "idx_apikey_key" ON "apikey" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_apikey_reference_id" ON "apikey" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "idx_access_log_credential_id_ts" ON "access_log" USING btree ("credential_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_access_log_agent_id_ts" ON "access_log" USING btree ("agent_id","timestamp");--> statement-breakpoint
CREATE INDEX "idx_credentials_user_id" ON "credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_invitation_organization_id" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_invitation_email" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_member_organization_id" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_member_user_id" ON "member" USING btree ("user_id");