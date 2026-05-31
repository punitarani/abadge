---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Internal: remove the `as Parameters<typeof betterAuth>[0]["database"]` casts from the `@abadge/trpc` better-auth test helpers (added in #244). The casts worked around a duplicate `@better-auth/core@1.5.6` install whose nominally-incompatible `BetterAuthOptions` broke `tsc`. The duplication was driven by a stale `kysely@0.28.15` copy lingering in `node_modules` (a `--frozen` install never purges extraneous dirs) — the lockfile already pins a single `kysely@0.28.17` via the existing root `overrides`, so a clean install collapses the duplicate and `tsc` unifies the adapter with the `database` field directly. No source/runtime change; `bun run typecheck` is 14/14 without the casts.
