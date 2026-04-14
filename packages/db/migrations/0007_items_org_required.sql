-- Preflight: any remaining NULL organization_id rows indicate the roadmap backfill
-- (migration 0006 + scripts/roadmap-backfill.ts) didn't run or left data behind.
-- Fail loud with an actionable hint rather than a silent NOT NULL violation below.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "items" WHERE "organization_id" IS NULL) THEN
    RAISE EXCEPTION 'items with NULL organization_id exist — run scripts/roadmap-backfill.ts before applying 0007';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "items" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint

-- Flip items.organization_id FK from ON DELETE set null -> ON DELETE cascade.
-- Items belong to their org; if the org is deleted the items go with it rather
-- than orphaning to a NULL-org state that bypasses every org-scoped WHERE filter.
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_organization_id_organization_id_fk";--> statement-breakpoint

ALTER TABLE "items" ADD CONSTRAINT "items_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
