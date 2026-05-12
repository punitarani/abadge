-- §RM-PR1 — Items belong to the organization, not to a user. Rename
-- `user_id` to `created_by` (audit metadata, not ownership), make it nullable,
-- and shift the foreign key to ON DELETE SET NULL so deleting the user
-- preserves the item with a NULL audit trail.
--
-- Drizzle-kit defaulted to DROP COLUMN + ADD COLUMN because the rename was
-- not interactively confirmed. Hand-edited to use RENAME so existing items
-- keep their createdBy attribution across the migration.
ALTER TABLE "items" DROP CONSTRAINT "items_user_id_user_id_fk";--> statement-breakpoint
DROP INDEX "items_user_id_idx";--> statement-breakpoint
ALTER TABLE "items" RENAME COLUMN "user_id" TO "created_by";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_created_by_idx" ON "items" USING btree ("created_by");
