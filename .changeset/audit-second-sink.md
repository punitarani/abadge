---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Add a best-effort second audit sink for tamper detection (AB-0024). Every committed `audit_logs` row is mirrored to the structured log stream (an `audit_mirror` line, shipped off-box via Workers Logs → Logpush to an append-only store), so a DB-side deletion is detectable by comparing the two sinks. The mirror is best-effort and never throws, so sink failure cannot block or fail a user/agent request. `scripts/audit-divergence-check.ts` compares the DB against a sink export and flags any audit event present in the sink but missing from the DB.
