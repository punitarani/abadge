---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Supply-chain hardening. Raise dependency floors above known-CVE thresholds — `hono >=4.10.2` (CVE-2025-62610), `@trpc/server >=11.8.0` (CVE-2025-68130), `effect >=3.20.0` (CVE-2026-32887) (AB-0103); align Better Auth to a single `1.5.6` across the workspace, matching the existing override (AB-0100); and add a report-only CI dependency-audit job (AB-0101). Resolved versions are unchanged (the lockfile already floated above the floors and the vulnerable features are unused) — this prevents a future install from resolving into vulnerable ranges.
