ALTER TABLE "agent_enrollment_tokens" DROP CONSTRAINT "agent_enrollment_tokens_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_sessions" DROP CONSTRAINT "agent_sessions_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_granted_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_enrollment_tokens" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_sessions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "granted_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_enrollment_tokens" ADD CONSTRAINT "agent_enrollment_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;