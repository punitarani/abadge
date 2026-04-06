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

Lists stored item metadata only.

### `request_access`

Checks whether the caller can use an item through a mount-style capability.

### `run_with_secret`

Resolves an item and injects it into a subprocess without returning the secret to the model.

### `mount_secret`

Mounts an item into a temporary file and returns the file path only.

### `get_audit`

Fetches recent audit entries from the control plane.

## Security model

The MCP server treats the model as untrusted:

* `list_items` returns metadata only
* `request_access` returns status only
* `run_with_secret` exposes command output, not the secret
* `mount_secret` exposes a file path, not the secret
* there is no tool that returns raw secret bytes directly to the model

For zero-knowledge items, the MCP server still delegates decrypt work to the local daemon.
