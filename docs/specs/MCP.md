# MCP Server Specification

The abadge MCP server is a stdio MCP surface for local AI runtimes.

Its security model is fixed: the model never receives raw secret material.

On startup the server sweeps orphaned `abadge-*` temp directories older than 10 minutes.

## Transport

| Property | Value |
|----------|-------|
| Protocol | MCP |
| Transport | stdio |
| Server name | `abadge` |

## Authentication model

Runtime auth is keypair-backed and is the only method:

1. load `agentId` and `privateKeyPath`
2. call `auth.createChallenge`
3. sign the challenge locally with the Ed25519 private key
4. call `auth.exchangeSession`
5. reuse the returned `abs_...` token until it is near expiry

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

### `use_secret`

Runs a command with a secret injected as an environment variable. Accepts exactly one of `itemId`
(single item) or `profileId` (every env-shaped item in a profile). Returns only the exit code,
duration, output-line count, and a truncation flag — never the secret or the subprocess
stdout/stderr text. Each output stream is captured but bounded to 8 KB; secret material is capped at
4 KB.

### `mount_secret`

Mounts a secret as a temporary file (0600). Returns only an opaque `mountId` (the file path is never
returned to the model). Auto-cleans after 5 minutes.

### `release_mount`

Releases a previously mounted secret file and its temporary directory immediately.

### `get_audit`

Fetches recent audit entries visible to the authenticated operator or local agent context.

## Security posture

The MCP server is intentionally designed so the model sees:

* item metadata
* exit codes, duration, output-line counts, and a truncation flag (never command output)
* opaque mount handles (`mountId`), never mounted file paths
* audit metadata

The model does not directly receive:

* raw plaintext secret values
* command stdout/stderr
* decrypted zero-knowledge payloads
* private-key material
* bearer session tokens intended for operators

For zero-knowledge items, the MCP server still relies on the local daemon for decrypt operations.
