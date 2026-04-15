DROP INDEX "idx_invitation_email";--> statement-breakpoint
ALTER TABLE "invitation" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "token_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "used_by" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_used_by_user_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_invitation_token_hash" ON "invitation" USING btree ("token_hash");