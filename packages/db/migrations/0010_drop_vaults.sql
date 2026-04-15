-- Phase D: drop the legacy per-user vaults table.
--
-- The web app, SDK, and CLI now operate exclusively on org-scoped profiles.
-- Migration 0006 backfilled every legacy vault into a "default" profile in
-- the user's personal org, so no data is lost by this drop.
--
-- items.vault_id (legacy FK to vaults) is dropped together with its index;
-- profile_id has carried that linkage since the v0 cutover.

DROP INDEX IF EXISTS "items_vault_id_idx";
ALTER TABLE "items" DROP COLUMN IF EXISTS "vault_id";
DROP TABLE IF EXISTS "vaults" CASCADE;
