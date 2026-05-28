ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "server_encryption_count" bigint NOT NULL DEFAULT 0;
