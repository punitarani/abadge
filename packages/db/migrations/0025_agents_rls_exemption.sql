-- §AB-0011 follow-up — exempt `agents` from row-level security.
--
-- 0021_rls_backstop FORCE-enabled RLS on agents with an org_isolation policy
-- keyed on the `app.current_org` GUC. But the agents table is read PRE-org-context
-- during authentication: auth.ts resolveAgentIdentity → verifyLocalAgentIdentity
-- (lookup by secretPrefix) and verifyAgentSessionIdentity (session-token-hash →
-- agent id) must read an agent row BEFORE any org GUC can be set, because the org
-- is *derived from* that row. Gating agents on app.current_org is therefore an
-- unbreakable bootstrap deadlock — the policy needs the org, but the org comes
-- from the row the policy would hide. Under the NOBYPASSRLS runtime role this
-- makes every agent authentication fail closed (zero rows → no agent resolves).
--
-- Org isolation for agents is enforced at the application layer instead: every
-- post-auth agents query filters by organization_id (agents router, requireAgentOwnership,
-- the revoke/rotate updates, and the member-removed cascade). The only unfiltered
-- read is `getCurrentAgent`, which fetches the authenticated agent's own globally
-- unique id and so cannot cross orgs. This mirrors audit_logs, which 0021 also
-- (intentionally) leaves outside RLS.
--
-- Idempotent: DROP POLICY IF EXISTS + DISABLE are safe to re-run.
DROP POLICY IF EXISTS "org_isolation" ON "agents";--> statement-breakpoint
ALTER TABLE "agents" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents" DISABLE ROW LEVEL SECURITY;
