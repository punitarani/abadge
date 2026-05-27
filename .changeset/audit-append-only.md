---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Enforce `audit_logs` append-only at the database (AB-0020). Migration 0018 installs a `BEFORE UPDATE/DELETE` immutability trigger that RAISEs, so audit rows cannot be rewritten or deleted by any role — a bug, compromised Worker, or insider can no longer silently erase evidence of an unauthorized access. INSERT still succeeds; TRUNCATE (row-trigger-bypassing) is left for the complementary REVOKE from a least-privilege application role (AB-0012).
