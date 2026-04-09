# MCP Server

The abadge MCP server exposes item-aware tools to local AI agents without returning raw secrets to
the model by default.

## Setup

Preferred configuration:

```bash
export ABADGE_API_URL=http://localhost:8787
export ABADGE_AGENT_ID=agent_...
export ABADGE_PRIVATE_KEY_PATH=~/.abadge/agents/mcp.ed25519.jwk
```

If `~/.abadge/config.json` already contains `localAgents.mcp`, the MCP server can use that instead.

Legacy fallback during migration:

```bash
export ABADGE_AUTH_TOKEN=abl_legacy_agent_key
```

The MCP server prints a deprecation warning when the legacy token path is used.

Run it with:

```bash
bun run mcp
```

Or directly:

```bash
bun packages/mcp/src/index.ts
```

## Claude Desktop / IDE example

```json
{
  "mcpServers": {
    "abadge": {
      "command": "bun",
      "args": ["packages/mcp/src/index.ts"],
      "env": {
        "ABADGE_API_URL": "http://localhost:8787",
        "ABADGE_AGENT_ID": "agent_...",
        "ABADGE_PRIVATE_KEY_PATH": "/Users/you/.abadge/agents/mcp.ed25519.jwk"
      }
    }
  }
}
```

## Runtime auth model

For keypair-backed agents the MCP server:

1. creates an anonymous API client
2. requests an agent challenge
3. signs the challenge with the configured private key
4. exchanges the signature for a short-lived `abs_...` session
5. reuses that session until it is near expiry

## Tool reference

### `list_items`

Lists stored item metadata (IDs, storage mode, timestamps). Never returns secret values.

### `run_with_secret`

Runs a command with a secret injected as an environment variable. Returns only the exit code and a
path to the output log file. The secret and command output are never returned to the model. The log
file is deleted automatically after 5 minutes.

### `mount_secret`

Mounts a secret as a temporary file with restricted permissions (0600). Returns only the file path.
Auto-cleans after 5 minutes, or call `release_mount` to clean up early.

### `release_mount`

Releases a previously mounted secret file, removing it and its temporary directory immediately.
Accepts the file path returned by `mount_secret`.

### `get_audit`

Fetches recent audit entries from the control plane.

## Security model

The MCP server treats the model as untrusted:

* `list_items` returns metadata only
* `run_with_secret` returns only exit code and log file path, never command output or secrets; the
  log file is removed after 5 minutes
* `mount_secret` exposes a file path, not the secret
* `release_mount` cleans up mounted files
* there is no tool that returns raw secret bytes directly to the model

For zero-knowledge items, the MCP server still delegates decrypt work to the local daemon.
