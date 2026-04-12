-- v0 roadmap foundation cutover
-- Additive only: create org/profile/agent/permission/audit_log roadmap tables,
-- preserve legacy tables, and backfill deterministic ownership metadata.

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "organization_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "profile_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "label" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "kind" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "items" SET "tags" = '[]'::jsonb WHERE "tags" IS NULL;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'items_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "items"
    ADD CONSTRAINT "items_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "storage_mode" text NOT NULL,
  "wrapped_root_key" text,
  "kdf_salt" text,
  "kdf_params" jsonb,
  "recovery_wrapped_root_key" text,
  "key_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "profiles"
    ADD CONSTRAINT "profiles_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'items_profile_id_profiles_id_fk'
  ) THEN
    ALTER TABLE "items"
    ADD CONSTRAINT "items_profile_id_profiles_id_fk"
    FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "agents" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "created_by" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "kind" text NOT NULL,
  "locality" text NOT NULL,
  "auth_method" text NOT NULL,
  "secret_hash" text,
  "secret_prefix" text,
  "public_key" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "agents"
    ADD CONSTRAINT "agents_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agents_created_by_user_id_fk'
  ) THEN
    ALTER TABLE "agents"
    ADD CONSTRAINT "agents_created_by_user_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "permissions" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "item_id" text NOT NULL,
  "capability" text NOT NULL,
  "expires_at" timestamp with time zone,
  "granted_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'permissions_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "permissions"
    ADD CONSTRAINT "permissions_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'permissions_agent_id_agents_id_fk'
  ) THEN
    ALTER TABLE "permissions"
    ADD CONSTRAINT "permissions_agent_id_agents_id_fk"
    FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'permissions_item_id_items_id_fk'
  ) THEN
    ALTER TABLE "permissions"
    ADD CONSTRAINT "permissions_item_id_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "public"."items"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'permissions_granted_by_user_id_fk'
  ) THEN
    ALTER TABLE "permissions"
    ADD CONSTRAINT "permissions_granted_by_user_id_fk"
    FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "user_id" text NOT NULL,
  "agent_id" text,
  "item_id" text,
  "profile_id" text,
  "surface" text,
  "event_type" text NOT NULL,
  "result" text NOT NULL,
  "delivery_mode" text,
  "field" text,
  "purpose" text,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ip_address" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_logs_organization_id_organization_id_fk'
  ) THEN
    ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_organization_id_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'audit_logs_profile_id_profiles_id_fk'
  ) THEN
    ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_profile_id_profiles_id_fk"
    FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id")
    ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "items_organization_id_idx" ON "items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_profile_id_idx" ON "items" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_organization_id_idx" ON "profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_name_idx" ON "profiles" USING btree ("organization_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_organization_id_idx" ON "agents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_created_by_idx" ON "agents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_secret_prefix_idx" ON "agents" USING btree ("secret_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_unique_idx" ON "permissions" USING btree ("agent_id", "item_id", "capability");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permissions_organization_id_idx" ON "permissions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permissions_agent_id_idx" ON "permissions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permissions_item_id_idx" ON "permissions" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_organization_id_idx" ON "audit_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_agent_id_idx" ON "audit_logs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_item_id_idx" ON "audit_logs" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_profile_id_idx" ON "audit_logs" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_occurred_at_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint

INSERT INTO "organization" ("id", "name", "slug", "metadata", "created_at")
SELECT
  'org_personal_' || u."id",
  COALESCE(NULLIF(btrim(u."name"), ''), NULLIF(btrim(u."email"), ''), u."id") || ' Personal',
  'personal-' || COALESCE(
    NULLIF(left(trim(both '-' from regexp_replace(lower(u."id"), '[^a-z0-9]+', '-', 'g')), 48), ''),
    'user'
  ),
  json_build_object('kind', 'personal', 'migratedFromUserId', u."id")::text,
  COALESCE(u."created_at", now())
FROM "user" u
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
SELECT
  'member_personal_' || u."id",
  'org_personal_' || u."id",
  u."id",
  'owner',
  COALESCE(u."created_at", now())
FROM "user" u
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

UPDATE "session"
SET "active_organization_id" = 'org_personal_' || "user_id"
WHERE "active_organization_id" IS NULL;--> statement-breakpoint

INSERT INTO "profiles" (
  "id",
  "organization_id",
  "name",
  "description",
  "storage_mode",
  "wrapped_root_key",
  "kdf_salt",
  "kdf_params",
  "recovery_wrapped_root_key",
  "key_version",
  "created_at",
  "updated_at"
)
SELECT
  'profile_default_' || v."id",
  'org_personal_' || v."user_id",
  'default',
  'Migrated from the legacy per-user vault.',
  'zero_knowledge',
  v."wrapped_root_key",
  v."kdf_salt",
  v."kdf_params",
  v."recovery_wrapped_root_key",
  v."key_version",
  v."created_at",
  v."updated_at"
FROM "vaults" v
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

UPDATE "items"
SET "organization_id" = 'org_personal_' || "user_id"
WHERE "organization_id" IS NULL;--> statement-breakpoint

UPDATE "items" i
SET "profile_id" = 'profile_default_' || i."vault_id"
WHERE i."profile_id" IS NULL
  AND i."vault_id" IS NOT NULL;--> statement-breakpoint

UPDATE "items"
SET "label" = 'migrated-' || substring("id" from 1 for 8)
WHERE "storage_mode" = 'zero_knowledge'
  AND ("label" IS NULL OR "label" = '');--> statement-breakpoint

-- Server-managed labels require app-layer decryption with ENCRYPTION_KEY.
-- packages/db/src/roadmap-backfill.ts provides the deterministic fallback rules
-- until a runtime backfill command is wired in.

INSERT INTO "agents" (
  "id",
  "organization_id",
  "created_by",
  "name",
  "description",
  "kind",
  "locality",
  "auth_method",
  "secret_hash",
  "secret_prefix",
  "public_key",
  "enabled",
  "revoked_at",
  "last_used_at",
  "metadata",
  "created_at"
)
SELECT
  p."id",
  'org_personal_' || p."user_id",
  p."user_id",
  p."name",
  NULLIF(p."metadata"->>'description', ''),
  CASE
    WHEN p."kind" = 'local_mcp' THEN 'local_mcp'
    WHEN p."kind" IN ('device', 'local_cli') THEN 'local_cli'
    ELSE 'remote'
  END,
  CASE
    WHEN p."kind" IN ('device', 'local_cli', 'local_mcp') THEN 'local'
    ELSE 'remote'
  END,
  COALESCE(p."auth_method", 'legacy_api_key'),
  p."secret_hash",
  p."secret_prefix",
  p."public_key",
  p."enabled",
  p."revoked_at",
  p."last_used_at",
  COALESCE(p."metadata", '{}'::jsonb),
  p."created_at"
FROM "principals" p
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "permissions" (
  "id",
  "organization_id",
  "agent_id",
  "item_id",
  "capability",
  "expires_at",
  "granted_by",
  "created_at"
)
SELECT
  g."id",
  COALESCE(i."organization_id", a."organization_id", 'org_personal_' || g."granted_by"),
  g."principal_id",
  g."item_id",
  g."capability",
  g."expires_at",
  g."granted_by",
  g."created_at"
FROM "grants" g
LEFT JOIN "items" i ON i."id" = g."item_id"
LEFT JOIN "agents" a ON a."id" = g."principal_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

INSERT INTO "audit_logs" (
  "id",
  "organization_id",
  "user_id",
  "agent_id",
  "item_id",
  "profile_id",
  "surface",
  "event_type",
  "result",
  "delivery_mode",
  "field",
  "purpose",
  "meta",
  "ip_address",
  "occurred_at"
)
SELECT
  l."id",
  COALESCE(i."organization_id", 'org_personal_' || l."user_id"),
  l."user_id",
  l."principal_id",
  l."item_id",
  i."profile_id",
  'legacy',
  CASE
    WHEN l."event_type" = 'principal.create' THEN 'agent.create'
    WHEN l."event_type" = 'principal.rotate' THEN 'agent.rotate'
    WHEN l."event_type" = 'principal.revoke' THEN 'agent.revoke'
    WHEN l."event_type" = 'grant.create' THEN 'permission.create'
    WHEN l."event_type" = 'grant.revoke' THEN 'permission.revoke'
    ELSE l."event_type"
  END,
  l."result",
  l."delivery_mode",
  NULLIF(l."meta"->>'field', ''),
  NULLIF(l."meta"->>'purpose', ''),
  COALESCE(l."meta", '{}'::jsonb),
  l."ip_address",
  l."occurred_at"
FROM "audit_log" l
LEFT JOIN "items" i ON i."id" = l."item_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

SELECT setval(
  pg_get_serial_sequence('"audit_logs"', 'id'),
  COALESCE((SELECT MAX("id") FROM "audit_logs"), 1),
  true
);
