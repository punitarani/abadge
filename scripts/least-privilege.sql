-- §AB-0012 — least-privilege application database role.
--
-- Run this as the database OWNER (the role that owns the schema and runs
-- migrations). It provisions `app_runtime`, the role the application runtime
-- connects as. The owner keeps DDL rights; `app_runtime` gets DML only and
-- cannot mutate the audit trail.
--
-- audit_logs immutability is defended on two layers:
--   1. The 0018 `audit_logs_no_mutation` trigger rejects UPDATE/DELETE for any
--      role (even a superuser) — but TRUNCATE bypasses row-level triggers.
--   2. Step 5 REVOKEs the UPDATE/DELETE granted in step 3. TRUNCATE is never
--      granted to this non-owner role, so the gap the trigger leaves for TRUNCATE
--      is closed by the role simply never holding the privilege.
--
-- See docs/runbooks/least-privilege-db-role.md for the production (PlanetScale)
-- provisioning + connection-cutover procedure.

-- 1. The role. NOSUPERUSER + NOBYPASSRLS are load-bearing: a superuser or a
--    BYPASSRLS role would defeat the trigger and any future row-level security.
CREATE ROLE app_runtime WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

-- 2. Connect + read the schema (but not create objects in it).
GRANT CONNECT ON DATABASE abadge TO app_runtime;
GRANT USAGE ON SCHEMA public TO app_runtime;

-- 3. Application DML on the current tables + sequences.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- 4. Same DML on tables created by future migrations (run by the owner).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;

-- 5. Strip write access to audit_logs (leaving INSERT + SELECT): REVOKE the
--    UPDATE/DELETE granted in step 3. TRUNCATE was never granted, so revoking it
--    too is belt-and-suspenders against a future GRANT ALL.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_runtime;
