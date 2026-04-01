-- Transition from the legacy credential-firewall schema to the
-- zero-knowledge-first schema without rewriting migration history.

CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"principal_id" text,
	"item_id" text,
	"event_type" text NOT NULL,
	"result" text NOT NULL,
	"delivery_mode" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "principals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"locality" text NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text,
	"secret_prefix" text,
	"public_key" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vaults" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wrapped_root_key" text NOT NULL,
	"kdf_salt" text NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"recovery_wrapped_root_key" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"vault_id" text,
	"storage_mode" text NOT NULL,
	"encrypted_item_key" text,
	"key_nonce" text,
	"ciphertext" text,
	"content_nonce" text,
	"server_ciphertext" text,
	"server_iv" text,
	"server_key_version" integer,
	"crypto_version" integer DEFAULT 1 NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "grants" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"item_id" text NOT NULL,
	"capability" text NOT NULL,
	"expires_at" timestamp with time zone,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "principals" ADD CONSTRAINT "principals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_principal_id_idx" ON "audit_log" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_item_id_idx" ON "audit_log" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "principals_user_id_idx" ON "principals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "principals_secret_prefix_idx" ON "principals" USING btree ("secret_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vaults_user_id_idx" ON "vaults" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_user_id_idx" ON "items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_vault_id_idx" ON "items" USING btree ("vault_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grants_unique_idx" ON "grants" USING btree ("principal_id","item_id","capability");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_principal_id_idx" ON "grants" USING btree ("principal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "grants_item_id_idx" ON "grants" USING btree ("item_id");--> statement-breakpoint

INSERT INTO "principals" (
	"id",
	"user_id",
	"kind",
	"locality",
	"name",
	"secret_hash",
	"secret_prefix",
	"enabled",
	"revoked_at",
	"last_used_at",
	"metadata",
	"created_at"
)
SELECT
	a."id",
	a."reference_id",
	'remote_agent',
	'remote',
	COALESCE(a."name", 'migrated-agent-' || a."id"),
	a."key",
	CASE
		WHEN a."start" IS NOT NULL AND length(a."start") >= 8 THEN substring(a."start" from 1 for 8)
		WHEN a."prefix" IS NOT NULL AND length(a."prefix") >= 8 THEN substring(a."prefix" from 1 for 8)
		ELSE NULL
	END,
	COALESCE(a."enabled", true),
	CASE
		WHEN COALESCE(a."enabled", true) THEN NULL
		ELSE COALESCE(a."updated_at", a."last_request", a."created_at")
	END,
	a."last_request",
	CASE
		WHEN a."metadata" IS NULL OR a."metadata" = '' THEN '{}'::jsonb
		ELSE jsonb_build_object('legacyMetadata', a."metadata")
	END,
	a."created_at"
FROM "apikey" a
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "items" (
	"id",
	"user_id",
	"vault_id",
	"storage_mode",
	"server_ciphertext",
	"server_iv",
	"server_key_version",
	"crypto_version",
	"content_version",
	"created_at",
	"updated_at",
	"deleted_at"
)
SELECT
	c."id"::text,
	c."user_id",
	NULL,
	'server_managed',
	NULLIF(c."encrypted_value", ''),
	NULLIF(c."iv", ''),
	CASE
		WHEN c."encrypted_value" IS NULL OR c."encrypted_value" = '' THEN NULL
		ELSE 1
	END,
	1,
	1,
	c."created_at",
	c."updated_at",
	NULL
FROM "credentials" c
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "grants" (
	"id",
	"principal_id",
	"item_id",
	"capability",
	"expires_at",
	"granted_by",
	"created_at"
)
SELECT
	p."agent_id" || ':' || p."credential_id"::text || ':reveal_plaintext',
	p."agent_id",
	p."credential_id"::text,
	'reveal_plaintext',
	p."expires_at",
	p."granted_by",
	p."granted_at"
FROM "agent_credential_permissions" p
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

INSERT INTO "audit_log" (
	"id",
	"user_id",
	"principal_id",
	"item_id",
	"event_type",
	"result",
	"delivery_mode",
	"meta",
	"ip_address",
	"occurred_at"
)
SELECT
	l."id",
	COALESCE(c."user_id", a."reference_id"),
	l."agent_id",
	l."credential_id"::text,
	CASE
		WHEN l."delivery_mode" = 'env_inject' THEN 'access.mount_env'
		WHEN l."delivery_mode" = 'file_mount' THEN 'access.mount_file'
		ELSE 'access.reveal'
	END,
	COALESCE(l."outcome", 'allowed'),
	l."delivery_mode",
	jsonb_strip_nulls(
		jsonb_build_object(
			'legacyAction', l."action",
			'purpose', l."purpose",
			'credentialName', l."credential_name",
			'agentName', l."agent_name",
			'destination', l."destination",
			'environment', l."environment",
			'approvalId', l."approval_id",
			'sessionId', l."session_id",
			'connectorUsed', l."connector_used"
		)
	),
	l."ip_address",
	l."timestamp"
FROM "access_log" l
LEFT JOIN "credentials" c ON c."id" = l."credential_id"
LEFT JOIN "apikey" a ON a."id" = l."agent_id"
WHERE COALESCE(c."user_id", a."reference_id") IS NOT NULL
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint

SELECT setval(
	pg_get_serial_sequence('"audit_log"', 'id'),
	COALESCE((SELECT MAX("id") FROM "audit_log"), 1),
	true
);
