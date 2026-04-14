# MCP Server

The abadge MCP server exposes item-aware tools to AI agents without returning secret values to the
model. It runs as a subprocess MCP server over stdio.

## Setup

### Authentication

Two auth modes are supported.

**Keypair auth (preferred)** — set these environment variables:

```bash
export ABADGE_API_URL=http://localhost:8787
export ABADGE_AGENT_ID=agent_...
export ABADGE_PRIVATE_KEY_PATH=~/.abadge/agents/mcp.ed25519.jwk
```

The MCP server performs an Ed25519 session exchange on startup and automatically refreshes the
session before it expires.

**Legacy API key** — fallback during migration:

```bash
export ABADGE_AUTH_TOKEN=abl_legacy_agent_key
```

The MCP server prints a deprecation warning when the legacy token path is used.

The config file `~/.abadge/config.json` is also read; environment variables take precedence.

### Running

```bash
bun run mcp
# or directly
bun packages/mcp/src/index.ts
```

## Claude Desktop / MCP client config

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

## Keypair session lifecycle

For keypair-backed agents the MCP server:

1. Creates an anonymous API client
2. Requests an agent challenge (`abc_...`, 60-second TTL)
3. Signs the challenge with the configured Ed25519 private key
4. Exchanges the signature for a short-lived `abs_...` session (15-minute TTL)
5. Schedules automatic session refresh at T-2 minutes before expiry

## Startup behavior

On startup the server scans the OS temp directory for orphaned `abadge-*` mount directories older
than 10 minutes and removes them.

## Tool reference

### `list_items`

Lists stored item metadata (IDs, labels, kinds, storage modes, timestamps). Never returns secret
values.

Input: none.

Output: JSON array of item summaries.

### `run_with_secret`

Runs a command with a secret injected as an environment variable. Returns the exit code, captured
output lines (redacted and truncated to 4 KB total), and a truncation flag. The secret plaintext is
never returned to the model.

| Input field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | ID of the item to inject |
| `field` | string | no | Named field to inject (for multi-field items) |
| `command` | string | yes | Command to run |
| `args` | string[] | no | Command arguments |
| `envVarName` | string | no | Environment variable name (default: `ABADGE_SECRET`) |
| `purpose` | string | no | Why this credential is needed |

Output:

```json
{
  "exitCode": 0,
  "stdoutLines": ["line 1", "line 2"],
  "stderrLines": [],
  "truncated": false
}
```

Security:
- Secret value is replaced with `[REDACTED]` throughout stdout and stderr before returning
- Combined output is capped at 4 KB (stdout gets priority; stderr gets remaining budget)
- No file paths or secret content are returned to the model

### `mount_secret`

Mounts a secret as a temporary file with 0600 permissions. Returns an opaque `mountId` — the file
path is never returned to the model. The file auto-deletes after 5 minutes, or earlier with
`release_mount`.

| Input field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | ID of the item to mount |
| `field` | string | no | Named field to mount (for multi-field items) |
| `filename` | string | no | Custom filename (default: item ID) |
| `purpose` | string | no | Why this credential is needed |

Output:

```json
{
  "mountId": "3a8f1c...",
  "permissions": "0600",
  "expiresIn": "5 minutes"
}
```

The `mountId` is an opaque token. Pass it to `release_mount` to clean up early.

### `release_mount`

Releases a mounted secret by `mountId`, deleting the temp file immediately.

| Input field | Type | Required | Description |
|------|------|----------|-------------|
| `mountId` | string | yes | Opaque mount ID returned by `mount_secret` |

Output: `{ "released": true, "mountId": "..." }`.

### `get_audit`

Fetches recent audit entries from the control plane.

Input: none (optional filters may be supported).

Output: JSON array of audit entries.

## Error responses

Tool errors are returned as JSON text content with the shape:

```json
{ "error": "Human-readable message", "code": "<domain code>", "hint": "<remediation>", "meta": { ... } }
```

`error` is always present. `code`, `hint`, and `meta` are included when the underlying failure is an `AbadgeApiError` (tRPC layer errors from the control plane). Non-`AbadgeApiError` failures (daemon unavailable, filesystem errors, unexpected throws) emit `{ "error": "..." }` only. LLM integrators can parse the `code` field for deterministic branching; `hint` is a human-remediation string.

## Security model

The MCP server treats the model as untrusted:

| Guarantee | How it is enforced |
|---|---|
| Secrets never in model context | `list_items` returns metadata only; `run_with_secret` returns only redacted output; `mount_secret` returns only an opaque `mountId` |
| Output redaction | `run_with_secret` scans stdout/stderr and replaces every occurrence of the secret with `[REDACTED]` |
| Output size cap | Combined stdout+stderr capped at 4 KB |
| Opaque mount IDs | File paths are never returned; mount IDs are random hex tokens |
| Restricted file permissions | Mounted files use mode 0600 inside a 0700 temp directory |
| Auto-cleanup | Mounted files are deleted after 5 minutes; orphaned directories are swept on startup |
| No raw secret tool | No tool returns the raw secret bytes to the model |

For zero-knowledge items, the MCP server delegates decryption to the local daemon (which holds the
root key in memory).
