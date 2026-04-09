# MCP Server Specification

The abadge MCP server is a stdio MCP surface for local AI runtimes.

Its default security model is unchanged: the model should not receive raw secret material.

## Transport

| Property | Value |
|----------|-------|
| Protocol | MCP |
| Transport | stdio |
| Server name | `abadge` |

## Authentication model

Preferred runtime auth is keypair-backed:

1. load `agentId` and `privateKeyPath`
2. call `auth.createChallenge`
3. sign the challenge locally with the Ed25519 private key
4. call `auth.exchangeSession`
5. reuse the returned `abs_...` token until it is near expiry

Legacy fallback remains available during migration:

* `ABADGE_AUTH_TOKEN=abl_...`

The server prints a deprecation warning when the legacy token path is used.

## Configuration

Preferred environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ABADGE_API_URL` | yes | API endpoint URL |
| `ABADGE_AGENT_ID` | yes, unless config fallback is present | Provisioned MCP agent ID |
| `ABADGE_PRIVATE_KEY_PATH` | yes, unless config fallback is present | Path to Ed25519 private key JWK |

MCP-specific overrides are also supported:

| Variable | Description |
|----------|-------------|
| `ABADGE_MCP_AGENT_ID` | Overrides `ABADGE_AGENT_ID` for MCP only |
| `ABADGE_MCP_PRIVATE_KEY_PATH` | Overrides `ABADGE_PRIVATE_KEY_PATH` for MCP only |

Fallback config source:

* `~/.abadge/config.json`
* `localAgents.mcp`

## Example configuration

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

## Tools

### `list_items`

Returns item metadata only (IDs, storage mode, timestamps).

### `run_with_secret`

Runs a command with a secret injected as an environment variable. Returns only the exit code and a
path to the output log file. The secret and command output are never returned to the model.

### `mount_secret`

Mounts a secret as a temporary file (0600). Returns only the file path. Auto-cleans after 5 minutes.

### `release_mount`

Releases a previously mounted secret file and its temporary directory immediately.

### `get_audit`

Fetches recent audit entries visible to the authenticated operator or local agent context.

## Security posture

The MCP server is intentionally designed so the model sees:

* item metadata
* exit codes and log file paths (not command output)
* mounted file paths
* audit metadata

The model does not directly receive:

* raw plaintext secret values
* command stdout/stderr
* decrypted zero-knowledge payloads
* private-key material
* bearer session tokens intended for operators

For zero-knowledge items, the MCP server still relies on the local daemon for decrypt operations.
