---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Enable Better Auth session `cookieCache` (maxAge 60s) so the dashboard's per-request session validation reads a short-lived signed cookie instead of hitting the database on every authenticated request — removing the per-request `getSession` round-trip on the connection-pool-bound system. Scope: caches ONLY session identity; org-membership authorization stays a live per-request query (immediate org-revocation preserved), and agent `abs_` / personal `abu_` auth never read this cookie. Only session validity (logout/expiry/revocation) lags ≤ maxAge (60s); sensitive Better Auth endpoints bypass via `disableCookieCache`. cli/mcp patch — release-surface dependency closure (the test-helper change is under `@abadge/trpc`); no direct CLI/MCP behavior change (server-side auth config).
