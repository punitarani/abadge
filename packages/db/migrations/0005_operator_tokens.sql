CREATE TABLE IF NOT EXISTS "operator_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL
);--> statement-breakpoint

ALTER TABLE "operator_tokens"
ADD CONSTRAINT "operator_tokens_user_id_user_id_fk"
FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "operator_tokens"
ADD CONSTRAINT "operator_tokens_created_by_user_id_fk"
FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "operator_tokens_token_hash_idx" ON "operator_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_tokens_user_id_idx" ON "operator_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_tokens_token_prefix_idx" ON "operator_tokens" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_tokens_expires_at_idx" ON "operator_tokens" USING btree ("expires_at");--> statement-breakpoint
