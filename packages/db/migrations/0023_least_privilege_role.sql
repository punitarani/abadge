-- §AB-0012 / §AB-0020 — Restrict app_runtime role to DML-only (no DDL, no bypassing RLS).
--
-- Idempotent: re-running this migration is safe.
-- Role may not exist in all environments (CI, dev) — skip gracefully.
--
-- audit_logs immutability is defended on two layers:
--   1. The 0018 `audit_logs_no_mutation` trigger rejects UPDATE/DELETE for any
--      role (even a superuser) — but TRUNCATE bypasses row-level triggers.
--   2. This migration REVOKEs UPDATE/DELETE/TRUNCATE on audit_logs from app_runtime.
--      TRUNCATE is never granted to this non-owner role, so the gap the trigger
--      leaves for TRUNCATE is closed by the role simply never holding the privilege.
--
-- Role attributes NOSUPERUSER + NOBYPASSRLS are load-bearing: a superuser or a
-- BYPASSRLS role would defeat the 0018 trigger and any future row-level security.
-- The CREATE ROLE statement is skipped if the role already exists so re-runs are safe.

DO $$
BEGIN
  -- Create the role only if it does not exist yet.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    -- 2. Connect + read the schema (but not create objects in it).
    --    Use format() because GRANT CONNECT requires a literal identifier;
    --    current_database() makes the migration portable across env names.
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_runtime', current_database());
    GRANT USAGE ON SCHEMA public TO app_runtime;
    REVOKE CREATE ON SCHEMA public FROM app_runtime;

    -- 3. Application DML on the current tables + sequences.
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

    -- 4. Same DML on tables created by future migrations. NOTE: ALTER DEFAULT
    --    PRIVILEGES with no FOR ROLE clause applies only to objects created by
    --    the role running THIS statement (the migrator/owner). This is correct
    --    only while every migration is applied by that same owner role; a future
    --    migration run by a different owner would create tables app_runtime
    --    cannot touch (runtime "permission denied"). Keep all migrations on one
    --    owner, or extend this with FOR ROLE if that ever changes.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      REVOKE ALL ON TABLES FROM app_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

    -- 5. Strip write access to audit_logs (leaving INSERT + SELECT).
    --    TRUNCATE was never granted; revoking it is belt-and-suspenders against
    --    a future GRANT ALL.
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_logs FROM app_runtime;
  END IF;
END $$;
