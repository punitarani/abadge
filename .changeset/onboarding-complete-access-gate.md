---
"@abadge/cli": patch
---

Gate CLI access on completed onboarding. The server now rejects org-scoped
tRPC calls with `ONBOARDING_INCOMPLETE` (HTTP 403) when the user's
organization has no bootstrapped profile (`storageMode='server_managed'`
OR `wrappedRootKey IS NOT NULL`). The CLI's first call after a device-code
approval will surface this error if the user signed up but never finished
the profile-bootstrap step. Pre-existing `requireOrgRole` denials that
previously surfaced as HTTP 500 (a wrapping bug in `scopedSessionProcedure`)
now correctly surface as HTTP 403 — clients should rely on
`AbadgeApiError.code` rather than HTTP status to distinguish error classes.
No CLI binary code changed; the CLI just propagates the new server
behavior.
