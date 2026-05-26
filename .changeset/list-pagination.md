---
"@abadge/sdk": patch
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add cursor (keyset) pagination to the items, agents, and permissions list endpoints (AB-0050). Each accepts optional `cursor`/`limit` (server-bounded at 100) and returns `nextCursor`, ordered by `(createdAt DESC, id DESC)` so pages are stable and non-overlapping under concurrent inserts. Backward compatible at the wire level: the existing array key on each result is unchanged.

Because the new default page size (50) would otherwise silently truncate callers that expected the full list, the SDK list helpers (`listItems`, `listAgents`, `listPermissions`) now transparently drain every page and return the complete set. This restores prior behavior for `client.*.list()`, `client.agents.get`/`permissions.get` (list-then-find), and the CLI `export`/`import`/`list` commands, which would otherwise have seen only the first 50 rows. The web dashboard drains the same way for its client-side search and filtering.
