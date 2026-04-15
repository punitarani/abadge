-- Drop legacy tables superseded by the v0 cutover. All data was backfilled
-- into roadmap tables by 0006. Forward-only, destructive.

DROP TABLE IF EXISTS "grants" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "principals" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "operator_tokens" CASCADE;
