---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Bound the `app_runtime` database role to a 15s `statement_timeout` via migration 0029 (`ALTER ROLE`), so a runaway query cannot pin a scarce connection-pool slot. Set as a role default — a postgres-js driver GUC would be reset by Hyperdrive's transaction pooler — and a query canceled by it (SQLSTATE 57014) maps to a retryable 503. Effective once the app connects as `app_runtime` (cutover pending per the least-privilege runbook); a harmless no-op for the owner role until then, and deliberately not set on the owner (whose migrations + roadmap backfill can legitimately exceed 15s). cli/mcp patch — release-surface dependency closure (the verifying test assertion lives under `@abadge/trpc`); no CLI/MCP behavior change (DB role config).
