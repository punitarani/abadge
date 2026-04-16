---
"@abadge/cli": patch
---

Fix broken onboarding for new CLI users with stale org state.

A new user running `abadge login` would sign in via GitHub OAuth successfully, but every onboarding tRPC call then returned `401 ORG_MEMBERSHIP_REQUIRED` — including `organizations.list`, `organizations.create`, and `auth.recordLogin`. The CLI swallowed the 401 and left the user stranded.

**Root cause:** the browser tRPC client sends a persisted `X-Abadge-Org-Id` header from localStorage on every request. When that header referenced an org the current user wasn't a member of (stale state, a different user on the same browser, or any brand-new user inheriting leftover state), `resolveUserOrgId` and `resolveOptionalOrgId` rejected *before* the bootstrap fast-path could run. No scrub point existed.

**API/tRPC (release-surface for CLI):**
- `auth.recordLogin` moves from `sessionProcedure` to `userProcedure` so it tolerates users without org membership. The audit insert is skipped when `organizationId` is null (pre-onboarding has no org to attribute the login to); the row is written normally once the user has an org context. Keeps the audit schema org-consistent instead of mixing in null-org rows.

**Web (internal, noted for release-notes coherence):**
- `org-store` now persists `lastUserId` alongside the active org; `setActiveOrg` requires a `userId` arg so the store self-identifies its owner. Scrub guards in the dashboard layout and onboarding page detect session-user mismatches and clear the stale header before any org-scoped tRPC call fires. `nav-user` now calls `clearActiveOrg()` on signOut so the next user on the same browser doesn't inherit the prior user's org context.
- Device approval redirect queries server truth via `organizations.list` + `decideOnboardingStateFromList` instead of reading a potentially-stale slug. Brand-new users now land on `/onboarding` (previously bounced `/overview` → `/login`).
