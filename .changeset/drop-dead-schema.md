---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Schema cleanup: drop two dead objects. `items.content_nonce` was never written or read by application code (the ZK content nonce is prepended into `ciphertext`) (AB-0041), and the legacy singular `audit_log` table — superseded by `audit_logs` — was defined and exported but referenced by nothing (AB-0023). Migration `0017` drops both; the Drizzle schema no longer declares them. No behavior change.
