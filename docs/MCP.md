# MCP Server

The abadge MCP server exposes capability-aware credential tools to AI agents (Claude, Codex, Cursor,
etc.) via the Model Context Protocol. Secrets are never returned to the LLM by default.

## Setup

### Configuration

Set environment variables or create `~/.abadge/config.json`:

```bash
export ABADGE_API_URL=http://localhost:8787
export ABADGE_TOKEN=abl_your_api_key
```

### Running

```bash
# From monorepo
bun run mcp

# Directly
bun packages/mcp/src/index.ts
```

### Claude Desktop / IDE integration

Add to your MCP config (e.g., `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "abadge": {
      "command": "bun",
      "args": ["packages/mcp/src/index.ts"],
      "env": {
        "ABADGE_API_URL": "http://localhost:8787",
        "ABADGE_TOKEN": "abl_your_api_key"
      }
    }
  }
}
```

## Tools

### `list_items`

List items the principal has access to. Returns metadata only, never values.

Input: `{}` (no required parameters)

Output: `{ items: [{ id, name, storageMode, createdAt, updatedAt }] }`

### `request_access`

Request access to an item with a specific capability. Does NOT return the secret value.

Input:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | yes | Item to access |
| `capability` | enum | yes | `mount_env` or `mount_file` |
| `purpose` | string | no | Reason for access |

Output: `{ status, itemId, capability }` or `{ status: "pending_approval" }`

### `run_with_secret`

Run a command with a secret injected as an environment variable. The secret is never exposed to
the AI model -- only the command's stdout/stderr is returned (max 4KB each).

Input:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | yes | Item to inject |
| `command` | string | yes | Command to run |
| `args` | string[] | no | Command arguments |
| `envVarName` | string | no | Environment variable name |
| `purpose` | string | no | Reason for access |

Output: `{ exitCode, stdout, stderr }`

### `mount_secret`

Mount a secret as a temporary file with restricted permissions. Returns the file path, not the
content. Auto-cleanup after 5 minutes.

Input:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | yes | Item to mount |
| `filename` | string | no | Desired filename |
| `purpose` | string | no | Reason for access |

Output: `{ path, permissions: "0600", message }`

### `get_audit`

Get recent audit log entries.

Input:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | no | Filter by item |
| `limit` | number | no | Max entries to return (1-100) |

Output: `{ entries: [{ id, itemId, action, capability, outcome, timestamp }] }`

## Security model

The MCP server follows the principle that **the LLM is untrusted**:

* `run_with_secret` injects into a subprocess -- the LLM sees command output, not the secret
* `mount_secret` returns a file path -- the LLM can reference the path, not the content
* `request_access` returns a confirmation -- never the raw value
* `list_items` returns metadata -- never ciphertext or plaintext
* There is no tool that returns raw secret values to the LLM

All access goes through the same API authorization, capability matrix enforcement, and audit
pipeline as direct API calls. Every tool invocation that touches items is logged in the audit trail.

The MCP server authenticates as a local principal (`abl_` prefix), so it can access zero-knowledge
items via the local daemon.
