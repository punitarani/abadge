---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Throttle `last_used_at` writes on the hot authentication path. Previously every authenticated request issued an `UPDATE … SET last_used_at = now()` on `user_api_keys` / `agents` / `agent_sessions`; now the write only fires when the stored timestamp is null or older than 15 minutes (the staleness check lives in the `UPDATE`'s `WHERE`, so a fresh row matches zero rows and writes nothing). This removes per-request row-lock/WAL contention on the connection-pool-bound system. `last_used_at` is display-only — auth/expiry/revocation read `expires_at`/`revoked_at` — so ≤15-min staleness is harmless. cli/mcp patch — release-surface dependency closure (both depend on `@abadge/trpc`); no direct CLI/MCP behavior change.
