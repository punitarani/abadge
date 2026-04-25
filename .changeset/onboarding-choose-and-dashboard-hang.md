---
"@abadge/cli": patch
---

Fix new-user onboarding + dashboard hang. The CLI is unaffected at runtime —
this changeset exists because the PR touches a test comment in
`packages/trpc/` (a path watched by the CLI release surface) when removing
the auto-personal-org Better Auth hook. No CLI code changed.
