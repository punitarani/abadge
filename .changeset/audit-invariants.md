---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Pin the access pipeline's audit invariants with regression tests (AB-0022): every denied/expired agent access is audited before the error is raised, and a granted mount reservation plus its "allowed" audit row are written in one transaction (a forced audit-insert failure rolls back the reservation — zero reservations, zero allowed audit rows). Also correct the unauth-bearer audit-dedup comment to document its per-isolate, best-effort nature on Workers (AB-0021).
