---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add the org-scoped data-access layer foundation (`scopedDb`) — internal AB-0010 infrastructure. No behavior change yet: `scopedDb(executor, orgId)` bakes the `organization_id` filter into reads and inserts so a forgotten WHERE clause becomes structurally impossible, and a CI import-ban ratchet prevents new direct tenant-table access. Routers migrate onto it in follow-up PRs.
