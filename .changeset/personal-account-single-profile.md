---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Cap personal accounts at a single profile. `profiles.create` now rejects an additional profile on a personal organization (flagged via `organization.metadata`) with a new `PROFILE_LIMIT_EXCEEDED` (409) error; the cap check and the insert run in one transaction with a per-org advisory lock so concurrent creates cannot race past it. The cap is "at most one" — an existence check, not a blanket block — so an admin who deletes the seeded default profile can recreate exactly one. Team organizations remain uncapped. The CLI's `profile add` surfaces the new error hint, and the dashboard hides the create-profile affordance for personal accounts. No schema migration.
