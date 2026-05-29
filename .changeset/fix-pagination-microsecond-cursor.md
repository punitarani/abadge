---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Fix silent row drops in keyset pagination when >100 rows share an identical `created_at` timestamp (e.g. rows written in a single transaction). The cursor now carries microsecond-precision epoch values via `(EXTRACT(EPOCH FROM created_at) * 1000000)::bigint` instead of a millisecond-truncated ISO-8601 date string, so the equality branch of the `(createdAt DESC, id DESC)` predicate correctly matches all rows in the same microsecond group. Affects `items.list`, `items.listForAgent`, `agents.list`, and `permissions.list` — and the SDK `drainPages` helper that wraps them. Server-side `@abadge/trpc` fix; patch to satisfy the release-surface dependency closure (cli/mcp depend on `@abadge/trpc`).
