ALTER TABLE "principals"
ADD COLUMN IF NOT EXISTS "auth_method" text NOT NULL DEFAULT 'legacy_api_key';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "deviceCode" (
  "id" text PRIMARY KEY NOT NULL,
  "device_code" text NOT NULL,
  "user_code" text NOT NULL,
  "user_id" text,
  "client_id" text,
  "scope" text,
  "status" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_polled_at" timestamp with time zone,
  "polling_interval" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deviceCode_device_code_unique" UNIQUE("device_code"),
  CONSTRAINT "deviceCode_user_code_unique" UNIQUE("user_code")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_enrollment_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL,
  "user_id" text NOT NULL,
  "created_by" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_session_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL,
  "challenge_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agent_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "agent_enrollment_tokens"
ADD CONSTRAINT "agent_enrollment_tokens_agent_id_principals_id_fk"
FOREIGN KEY ("agent_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "deviceCode"
ADD CONSTRAINT "deviceCode_user_id_user_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "agent_enrollment_tokens"
ADD CONSTRAINT "agent_enrollment_tokens_user_id_user_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "agent_enrollment_tokens"
ADD CONSTRAINT "agent_enrollment_tokens_created_by_user_id_fk"
FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "agent_session_challenges"
ADD CONSTRAINT "agent_session_challenges_agent_id_principals_id_fk"
FOREIGN KEY ("agent_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "agent_sessions"
ADD CONSTRAINT "agent_sessions_agent_id_principals_id_fk"
FOREIGN KEY ("agent_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "agent_sessions"
ADD CONSTRAINT "agent_sessions_user_id_user_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agent_enrollment_tokens_token_hash_idx" ON "agent_enrollment_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_enrollment_tokens_agent_id_idx" ON "agent_enrollment_tokens" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_enrollment_tokens_user_id_idx" ON "agent_enrollment_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_session_challenges_hash_idx" ON "agent_session_challenges" USING btree ("challenge_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_session_challenges_agent_id_idx" ON "agent_session_challenges" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sessions_token_hash_idx" ON "agent_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_agent_id_idx" ON "agent_sessions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_user_id_idx" ON "agent_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_sessions_expires_at_idx" ON "agent_sessions" USING btree ("expires_at");--> statement-breakpoint
