---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add cursor (keyset) pagination to the items, agents, and permissions list endpoints (AB-0050). Each accepts optional `cursor`/`limit` (server-bounded at 100) and returns `nextCursor`, ordered by `(createdAt DESC, id DESC)` so pages are stable and non-overlapping under concurrent inserts. Backward compatible: the existing array key on each result is unchanged and callers that omit pagination get the first page. Web list/prefetch consumers thread the optional input.
