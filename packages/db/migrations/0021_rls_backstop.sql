-- §AB-0011 — Row-level security backstop behind the AB-0010 scoped DAL.
--
-- Defense in depth: even if an application query bypasses the scoped layer's
-- org filter, RLS returns zero rows for the wrong organization. The policy reads
-- the per-transaction GUC `app.current_org`, which `scopedDb` sets via
-- `SET LOCAL app.current_org = <orgId>` as the first statement of every scoped
-- transaction.
--
-- FAIL-CLOSED: `current_setting('app.current_org', true)` returns NULL when the
-- GUC is unset (e.g. a query that forgot to set it, or ran outside a transaction
-- where SET LOCAL never applied under connection pooling). `organization_id = NULL`
-- is never TRUE, so an unset context yields ZERO rows — never an unfiltered leak.
--
-- FORCE ROW LEVEL SECURITY makes the table owner subject to the policy too; only
-- superuser / BYPASSRLS roles bypass it. The runtime app role (`abadge_app`,
-- NOSUPERUSER NOBYPASSRLS, see packages/db/least-privilege.sql + AB-0012) is
-- subject; the migrator/owner and local superuser are not (so migrations and
-- admin tooling are unaffected).
--
-- audit_logs is intentionally NOT under RLS: it is append-only (AB-0020 trigger),
-- written by the audit-writer infrastructure with an explicit org, and must accept
-- writes regardless of a request's org context.

ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "items"
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "profiles"
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "agents"
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));--> statement-breakpoint

ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "permissions"
  USING ("organization_id" = current_setting('app.current_org', true))
  WITH CHECK ("organization_id" = current_setting('app.current_org', true));
