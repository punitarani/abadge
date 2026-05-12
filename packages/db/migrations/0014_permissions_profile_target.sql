DROP INDEX "permissions_unique_idx";--> statement-breakpoint
ALTER TABLE "permissions" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "permissions" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_agent_profile_cap_idx" ON "permissions" USING btree ("agent_id","profile_id","capability") WHERE "permissions"."profile_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "permissions_profile_id_idx" ON "permissions" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_unique_idx" ON "permissions" USING btree ("agent_id","item_id","capability") WHERE "permissions"."item_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_exactly_one_target" CHECK (("permissions"."item_id" IS NOT NULL AND "permissions"."profile_id" IS NULL)
       OR ("permissions"."item_id" IS NULL AND "permissions"."profile_id" IS NOT NULL));