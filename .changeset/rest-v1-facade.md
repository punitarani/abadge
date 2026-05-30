---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Repair the REST `/v1` facade (every route returned HTTP 500 due to a tRPC v11 caller-shape guard bug) and coerce the audit `limit` query param. Touches `packages/trpc`, which the CLI and MCP release binaries bundle.
