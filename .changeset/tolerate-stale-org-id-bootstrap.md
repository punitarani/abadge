---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Fix the onboarding/dashboard dead-end where a stale `activeOrgId` persisted in the browser (and sent as the `X-Abadge-Org-Id` header) made `organizations.list`/`create`/`createPersonal` fail with `ORG_MEMBERSHIP_REQUIRED`, stranding freshly-signed-up or account-switched users on the "We couldn't load your organizations" error card with no recovery. The bootstrap-safe resolver now treats a foreign `X-Abadge-Org-Id` as "no org context" and falls through to membership resolution, letting the client discover and repair its org context; org-scoped routes still reject a foreign header strictly. Server-side `@abadge/trpc` fix — patch to satisfy the release-surface dependency closure (cli/mcp depend on `@abadge/trpc`); no CLI/MCP behavior change.
