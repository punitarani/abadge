---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add integration coverage for `organizations.create` / `createPersonal` under the
restricted NOBYPASSRLS role, and document the FORCE-RLS deploy-ordering hazard in
the least-privilege runbook. Test/docs only — patch to satisfy the
release-surface dependency closure (cli/mcp depend on `@abadge/trpc`).
