-- §AB-0003 — preflight guard: every server_managed item must be bound to a
-- profile before the rest of the schema can rely on a non-null profileId.
--
-- The backfill itself requires re-encryption under the per-profile DEK, which
-- is application-level logic and cannot run inside a migration. Run the script
-- first, then apply this migration:
--
--   DATABASE_URL=... ENCRYPTION_KEY=... bun scripts/backfill-server-item-profiles.ts
--
-- This DO block fails loud (with an actionable message) rather than silently
-- producing a NOT NULL violation later, mirroring the pattern from 0007.
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
