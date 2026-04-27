# @abadge/mcp

## 0.0.2

### Patch Changes

- af6fbd7: Allow granting multiple capabilities per `(agent, item)` in one atomic call. `permissions.create`
  now accepts `capabilities: Capability[]` (non-empty, deduplicated) and writes every row inside
  a single Postgres transaction — partial grants are never observable. Matrix violations and
  duplicates are pre-checked, and the error envelope's `meta.invalidCapabilities` /
  `meta.duplicateCapabilities` lists every offender so the UI/CLI can recover precisely.

  CLI: `abadge permission create --capability X --capability Y` and `--capability X,Y,Z`
  both work — repeat the flag or comma-separate. Single-cap grants stay one short flag.

  Breaking change to the public SDK shape: `CreatePermissionInput.capability` (singular)
  becomes `capabilities: Capability[]`; `PermissionResult` is removed in favor of
  `PermissionListResult`. The DB row layout is unchanged; the audit log invariant
  (one `permission.create` row per granted capability) is preserved.

- 1c77662: Follow-up to PR #116 review feedback. Two small fixes:

  - `abadge agent register` now rejects `--json` + `--mcp-config` up front instead of accepting both. The combination produced a single nested JSON document that worked, but mixing a script-oriented flag (`--json`) with a human-paste flag (`--mcp-config`) is confusing. Use `abadge agent register --json` for scripts, then `abadge agent mcp-config <id>` to print the snippet.
  - `install.sh` now emits an explicit `warning:` line on stderr when `ABADGE_INSTALL_BASE_URL` is set without a scoped version. Previously a multi-package install (`ABADGE_INSTALL_PACKAGE=all`) would silently skip every package without explanation; the operator now sees which env var to set.

- 0c0f6e3: Add `abadge run --all` and the `run_with_all_secrets` MCP tool — bulk env-var
  injection scoped to the active profile.

  `abadge run --all -- <cmd>` injects every item in the active profile that the
  agent has `mount_env` on, with each item's label normalized to a POSIX env-var
  name (e.g. `openai-api-key` → `OPENAI_API_KEY`). Profile is the trust boundary:
  items in other profiles are NEVER injected, even if the agent has grants on
  them. Capped at 256 items per call. Each included item produces its own
  `access.mount_env` audit row tagged `meta.viaBulk = true`. Hard-rejects on
  env-var collisions and on labels that normalize to reserved keys
  (`PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, …).

  The MCP server gets the equivalent `run_with_all_secrets` tool with the same
  profile-scoped semantics and the same §RED1 contract — subprocess stdout/stderr
  is never forwarded to the model.

  `abadge run --item <id>` continues to work unchanged. Multi-field items
  (login, certificate, ssh_key) are silently skipped from `--all` — use
  `--item --field` for those.

  Server-side: new tRPC mutation `access.bulkMountEnv`. Daemon: new RPC
  `exec.envBulk`. Core: new `labelToEnvKey` helper. SDK: new
  `bulkAccessMountEnv` method on `AbadgeAgentClient`. (Internal packages
  @abadge/core, @abadge/sdk, @abadge/trpc, @abadge/daemon are versioned
  implicitly via the cli/mcp release pipelines — they're listed in the
  release registry's `changePaths` for both binary releases.)

- 55beb2d: Ship `abadge-mcp` as a distributable binary. The MCP server now releases through the same
  GitHub Actions pipeline as the CLI: per-platform `bun --compile` artifacts, SHA256-verified
  tarballs, and the existing `install.sh` installer (extended to support
  `ABADGE_INSTALL_PACKAGE={cli|mcp|all}` plus scoped `ABADGE_CLI_VERSION` /
  `ABADGE_MCP_VERSION` pins). `install.sh` defaults to installing both binaries when invoked
  without env vars.

  Add `--mcp-config` to `abadge agent register` and a standalone `abadge agent mcp-config <id>`
  subcommand. Both emit a paste-ready Claude Desktop `mcpServers` JSON snippet using absolute
  paths so it works under launchd/systemd-spawned MCP clients that do not inherit
  `~/.abadge/bin` in `$PATH`.
