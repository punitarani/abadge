-- §AB-0003 — one-shot preflight assertion: at apply time, every LIVE
-- server_managed item must already be bound to a profile (the application
-- layer's resolveTargetProfile guarantees this for new writes).
--
-- This is deliberately NOT a permanent CHECK/NOT NULL constraint: items.profile_id
-- uses ON DELETE SET NULL, so a server_managed item legitimately ends up with a
-- NULL profile_id after its profile is deleted. The condition asserted here is a
-- migration-time gate (run the backfill first), not a maintained schema invariant.
--
-- The backfill itself requires re-encryption under the per-profile DEK, which
-- is application-level logic and cannot run inside a migration. Run the script
-- first, then apply this migration:
--
--   DATABASE_URL=... ENCRYPTION_KEY=... bun scripts/backfill-server-item-profiles.ts
--
-- This DO block fails loud (with an actionable message) rather than letting an
-- un-backfilled deployment proceed silently, mirroring the pattern from 0007.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "items"
    WHERE "storage_mode" = 'server_managed'
      AND "profile_id" IS NULL
      AND "deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION
      'server_managed items with NULL profile_id detected — run '
      'scripts/backfill-server-item-profiles.ts (DATABASE_URL + ENCRYPTION_KEY required) '
      'before applying migration 0022';
  END IF;
END $$;
