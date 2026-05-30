---
"@abadge/cli": minor
---

`permission create` now accepts `--profile-id` to grant the canonical `read`/`use` capabilities across an entire profile, and requires exactly one of `--item-id`/`--profile-id`. Passing canonical `read`/`use` with `--item-id` now fails fast with an actionable hint (use `--profile-id`, or a legacy item capability) instead of a confusing server-side rejection. Fixes the dead-end where the CLI help advertised `read`/`use` but the CLI had no way to grant them.
