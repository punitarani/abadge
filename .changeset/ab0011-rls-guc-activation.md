---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Activate the AB-0011 row-level-security backstop so the app can run as the NOBYPASSRLS `app_runtime` role: the org-scoped tRPC middleware now runs each request inside a transaction that sets the `app.current_org` GUC the FORCE-RLS policies read, exempt the `agents` table from RLS (it is read pre-org-context during auth), and set the GUC explicitly on the multi-org and member-removal paths that cannot use the request middleware.
