---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Convert least-privilege REVOKE statements into an idempotent Drizzle migration; add startup assertion for audit_logs write privileges (§AB-0012, §AB-0020).
