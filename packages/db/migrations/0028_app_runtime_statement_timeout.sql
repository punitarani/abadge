-- §AB — Bound app_runtime per-statement execution so a runaway query cannot pin
-- a scarce connection-pool slot. PS-10 has ~25 max connections and Hyperdrive
-- holds a small active pool, so the connection pool — not query latency — is the
-- throughput wall; one query stuck far beyond the sub-second norm starves every
-- other request sharing that pool.
--
-- Set on the ROLE, not via the postgres-js driver: Hyperdrive runs in
-- transaction-pooling mode and RESETs driver-set session GUCs when a connection
-- returns to the pool, so `connection: { statement_timeout }` is a silent prod
-- no-op (it only sticks on direct connections, which masks the problem in local
-- :5433 tests). A role default survives RESET because RESET restores the role's
-- configured defaults. This is why PR #220 deferred statement_timeout to a
-- role-level migration rather than the driver.
--
-- 15s is ~100x the slowest observed legitimate app_runtime statement
-- (items.list over 160k rows measured ~41ms server-side; registration is
-- several fast statements in a transaction), so it never trips on real work and
-- only cancels a genuinely runaway query. It applies to the API runtime role
-- ONLY — the migrator/owner that runs migrations and the roadmap backfill is a
-- different, privileged role and is unaffected.
--
-- A statement canceled by this timeout raises SQLSTATE 57014, which the API
-- already maps to a retryable 503 (ServiceUnavailableError, PR #220).
--
-- Idempotent + env-safe: guarded on role existence exactly like 0023, so it is a
-- no-op anywhere app_runtime was not created, and re-running is safe. Applied by
-- the migrator/owner, which created app_runtime in 0023 and may therefore ALTER
-- it.
--
-- EFFECTIVE ONLY ONCE THE APP CONNECTS AS app_runtime. Per
-- docs/runbooks/least-privilege-db-role.md the app may still connect as the
-- OWNER role (the app_runtime cutover is gated on RLS-GUC wiring). While that
-- is the case this is a harmless no-op for the live runtime — it does NOT bound
-- the owner (deliberately: the owner runs migrations + the roadmap backfill,
-- which can legitimately exceed 15s). It activates automatically at cutover.
--
-- PROD VERIFICATION (NOT covered by local tests — a direct :5433 connection
-- would pass even if Hyperdrive dropped it): after the app_runtime cutover +
-- deploy, confirm through the Hyperdrive path that `SHOW statement_timeout`
-- returns `15s` for an app_runtime connection (a one-off query through the
-- deployed Worker). Local tests only assert the role default is set.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    ALTER ROLE app_runtime SET statement_timeout = '15s';
  END IF;
END $$;
