---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Account/organization deletion (`organizations.delete`) no longer blocks when items exist. Deletion now cascades through items, profiles, agents, and permissions (audit logs are preserved) and is gated by two server-re-checked requirements: a typed-name confirmation (`confirmName` must equal the org's current name → `CONFIRMATION_MISMATCH`) and re-authentication of the caller's account password (`REAUTH_FAILED`, or `REAUTH_PASSWORD_REQUIRED` for password-less social-login accounts). The `SDK AbadgeUserClient.orgs.delete(orgId, { confirmName, password })` signature now requires the confirmation object. Every attempt (allowed or denied) is audit-logged. Removed the now-unused `ORG_NOT_EMPTY` error code.
