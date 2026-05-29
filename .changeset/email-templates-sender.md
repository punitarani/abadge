---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Branded React Email templates for the verification and password-reset emails,
plus a dedicated transactional sender (`no-reply@notifications.abadge.io`,
overridable via `ABADGE_EMAIL_FROM` / `ABADGE_EMAIL_FROM_NAME`). Server-side
email rendering only — no CLI/MCP behavior change; patch to satisfy the
release-surface dependency closure (cli/mcp depend on `@abadge/auth`).
