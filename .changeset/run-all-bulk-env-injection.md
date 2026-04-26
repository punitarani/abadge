---
"@abadge/cli": minor
"@abadge/mcp": minor
"@abadge/sdk": minor
"@abadge/core": minor
"@abadge/trpc": minor
"@abadge/daemon": minor
---

Add `abadge run --all` and the `run_with_all_secrets` MCP tool — bulk env-var
injection scoped to the active profile.

`abadge run --all -- <cmd>` injects every item in the active profile that the
agent has `mount_env` on, with each item's label normalized to a POSIX env-var
name (e.g. `openai-api-key` → `OPENAI_API_KEY`). Profile is the trust boundary:
items in other profiles are NEVER injected, even if the agent has grants on
them. New tRPC mutation `access.bulkMountEnv`, new daemon RPC `exec.envBulk`,
new `labelToEnvKey` helper in core, new `bulkAccessMountEnv` method on
`AbadgeAgentClient`. Capped at 256 items per call. Each included item produces
its own `access.mount_env` audit row tagged `meta.viaBulk = true`. Hard-rejects
on env-var collisions and on labels that normalize to reserved keys
(`PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, …).

The MCP server gets the equivalent `run_with_all_secrets` tool with the same
profile-scoped semantics and the same §RED1 contract — subprocess stdout/stderr
is never forwarded to the model.

`abadge run --item <id>` continues to work unchanged. Multi-field items
(login, certificate, ssh_key) are silently skipped from `--all` — use
`--item --field` for those.
