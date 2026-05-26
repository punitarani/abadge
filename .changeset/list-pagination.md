---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add cursor (keyset) pagination to the items, agents, and permissions list endpoints (AB-0050). Each accepts optional `cursor`/`limit` (server-bounded at 100) and returns `nextCursor`, ordered by `(createdAt DESC, id DESC)` so pages are stable and non-overlapping under concurrent inserts. Backward compatible at the wire level: the existing array key on each result is unchanged.

Because the new default page size (50) would otherwise silently truncate callers that expected the full list, the bundled SDK list helpers (`listItems`, `listAgents`, `listPermissions`) now transparently drain every page and return the complete set. This keeps the CLI `export`/`import`/`list` commands and SDK list-then-find helpers (`agents.get`, `permissions.get`) correct for orgs larger than one page; without it they would have seen only the first 50 rows.
