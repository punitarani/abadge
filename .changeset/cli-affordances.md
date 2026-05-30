---
"@abadge/cli": minor
---

Fix CLI developer-experience papercuts: `org add` now accepts `--json` so scripts can create an organization and capture its id in one step; the no-organization error renders a CLI-actionable hint (`abadge org add` / `abadge org use`) instead of pointing at the web-only onboarding flow; the stale `abadge profile create` hint now points at the real `abadge profile add` subcommand; `run` rejects the silently-ignored combinations of `--all`/`--expand-env` with `--field`/`--env-var` up front instead of dropping them; and `profile list --json` emits a clean DTO (`id`, `name`, `externalId`, `description`, `storageMode`, `keyVersion`, `createdAt`, `updatedAt`) rather than leaking wrapped-key and KDF columns.
