# MCP Server

The abadge MCP server exposes credential management tools to AI agents (Claude, Codex, Cursor, etc.) via the Model Context Protocol. Secrets are never returned to the LLM by default.

## Setup

### Configuration

Set environment variables or create `~/.abadge/config.json`:

```bash
export ABADGE_API_URL=http://localhost:8787
export ABADGE_TOKEN=abd_your_api_key
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
        "ABADGE_TOKEN": "abd_your_api_key"
      }
    }
  }
}
```

## Tools

### `list_available_credentials`

List credentials the agent has access to. Returns names and metadata, never values.

### `request_secret_use`

Request to use a credential with a specific delivery mode. Does NOT return the secret.

Input: `{ credentialName, deliveryMode, purpose }`

Delivery modes: `env_inject`, `file_mount_tmpfs`, `operation_only`

### `run_with_secret`

Run a command with a credential injected as an environment variable. The secret is never exposed to the AI model — only the command's stdout/stderr is returned.

Input: `{ credentialName, command, args?, envVarName?, purpose? }`

### `fill_login`

Get instructions for browser-based login filling. Returns target URL and field identifiers, not the raw password.

Input: `{ credentialName, targetUrl }`

### `mount_secret_file`

Mount a credential as a temporary file with restricted permissions. Returns the file path.

Input: `{ credentialName, path?, purpose? }`

### `request_approval`

Check status of a pending approval or list pending approvals.

Input: `{ approvalId? }`

### `get_secret_metadata`

Get metadata about a credential without accessing its value.

Input: `{ credentialName }`

### `get_audit_context`

Get recent audit log entries.

Input: `{ credentialName?, limit? }`

## Security model

The MCP server follows the principle that **the LLM is untrusted**:

* `run_with_secret` injects into a subprocess — the LLM sees command output, not the secret
* `fill_login` returns form instructions — the broker does the actual fill
* `mount_secret_file` returns a file path — the LLM can reference the path, not the content
* `request_secret_use` returns a confirmation — never the raw value
* There is no `reveal_secret_plaintext` tool
