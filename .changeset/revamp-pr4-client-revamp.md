---
"@abadge/cli": patch
"@abadge/mcp": patch
---

Client revamp across CLI, MCP, SDK, and the mount-redemption flow:

**CLI**
- Verb rename: `create`→`add`, `delete`→`rm`, `register`→`add`,
  `revoke`→`rm`. Deprecated aliases hidden but warn-and-route for one
  release
- Unified `abadge run`: `--item` and `--profile` flow through
  `access.use` / `access.useProfile` → `redeemMount` → daemon
  `exec.expandEnv` / `exec.envBulk`
- `abadge use org/profile` context switcher
- Removed `vault.*` CLI commands entirely
- Removed `--legacy-api-key`; keypair-only agent registration

**MCP**
- Merged `run_with_secret` + `run_with_all_secrets` into unified
  `use_secret` with discriminated input
- §RED1 invariant test asserting no MCP tool's return shape contains
  `stdout` / `stderr` / `text` / raw secret value
- Fixes the pre-existing `buildChildEnv ABADGE_* stripping` test

**SDK**
- Removed deprecated `AbadgeClientConfig`; exposed `Abadge.User` /
  `Abadge.Agent` namespace
- `agent.access.read(itemId, opts?)` / `agent.access.use(target, opts)`
  replace three legacy methods
- `AbadgeUserClient` reshaped to namespaced operations

**Server-side mount redemption**
- New `access.redeemMount` tRPC procedure with atomic UPDATE/RETURNING
- Daemon stays auth-agnostic — CLI redeems and hands envelope to
  existing daemon RPCs
