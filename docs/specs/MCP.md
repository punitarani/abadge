# MCP Server Specification

> Tool reference for the abadge MCP (Model Context Protocol) server.
> The MCP server is the primary interface for AI agents to use secrets safely.

## Security Posture

The MCP server is designed with one overriding principle: **the LLM never sees raw secrets.**

| What the LLM sees | What the LLM does NOT see |
|-------------------|--------------------------|
| Item metadata (IDs, storage modes, timestamps) | Secret values |
| Access status (granted/denied) | Decrypted payloads |
| Subprocess stdout/stderr (truncated) | Environment variables injected into subprocess |
| File paths of mounted secrets | File contents |
| Audit log entries | Encrypted blobs |

This is enforced at the tool level — there is no tool that returns a raw secret value to the LLM context.

---

## Transport

| Property | Value |
|----------|-------|
| Protocol | MCP (Model Context Protocol) |
| Transport | stdio (stdin/stdout) |
| Server name | `abadge` |

---

## Configuration

The MCP server reads configuration from environment variables (preferred) or the CLI config file.

**Environment variables:**

| Variable | Required | Description |
|----------|----------|-------------|
| `ABADGE_API_URL` | yes | API endpoint URL |
| `ABADGE_AUTH_TOKEN` | yes | Local agent API key (`abl_` prefix) |

**Fallback:** `~/.abadge/config.json` (same format as CLI).

**Agent requirement:** The MCP server authenticates as a `local_mcp` agent. It needs an API key created with `kind: "local_mcp"`.

---

## MCP Client Configuration

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "abadge": {
      "command": "abadge",
      "args": ["mcp"],
      "env": {
        "ABADGE_API_URL": "https://api.abadge.dev",
        "ABADGE_AUTH_TOKEN": "abl_..."
      }
    }
  }
}
```

### Cursor / Other MCP Clients

Same structure — the MCP server is a stdio process that speaks the standard MCP protocol.

---

## Tools

### list_items

List stored items. Returns metadata only — never secret values.

**Use case:** Let the AI agent discover what secrets are available before requesting access.

```
Tool: list_items
Input: {}
Output:
{
  "items": [
    {
      "id": "string",
      "storageMode": "zero_knowledge" | "server_managed",
      "cryptoVersion": number,
      "contentVersion": number,
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601"
    }
  ]
}
```

**Security:** No secret data in response. Safe for LLM context.

---

### request_access

Check whether the agent has permission to access an item with a given capability. Does not return secret data.

**Use case:** Pre-flight check before attempting `run_with_secret` or `mount_secret`. Lets the AI agent know whether to proceed or ask the user to grant permission.

```
Tool: request_access
Input:
{
  "itemId": string,                          // Required. Item to check access for.
  "capability": "mount_env" | "mount_file",  // Required. Desired delivery mode.
  "purpose": string                          // Optional. Why access is needed (for audit).
}

Output (granted):
{
  "status": "granted",
  "itemId": "string",
  "capability": "mount_env"
}

Output (denied):
{
  "status": "denied",
  "error": "No permission for mount_env on this item"
}

Output (error):
{
  "status": "error",
  "error": "Daemon not running (required for zero-knowledge items)"
}
```

**Security:** Returns status only, never secret data. The `purpose` field is logged to the audit trail for accountability.

**Design note:** Capabilities are limited to `mount_env` and `mount_file` — the MCP server intentionally does not expose `reveal_plaintext` or `read_ciphertext` as these would return secret data to the LLM context.

---

### run_with_secret

Execute a subprocess with a secret injected as an environment variable. The secret is never returned to the LLM — only the subprocess output.

**Use case:** The core "use without seeing" pattern. The AI agent can use a secret (e.g., make an API call, deploy code, authenticate) without the secret appearing in the conversation.

```
Tool: run_with_secret
Input:
{
  "itemId": string,           // Required. Item to inject.
  "command": string,          // Required. Executable to run.
  "args": string[],           // Optional. Command arguments.
  "envVarName": string,       // Optional. Env var name (default: "ABADGE_SECRET").
  "purpose": string           // Optional. Why this credential is needed (for audit).
}

Output:
{
  "exitCode": number,
  "stdout": "string",
  "stderr": "string"
}
```

**Output constraints:**
- `stdout` and `stderr` are each truncated to **4096 bytes** (4 KB).
- If truncated, the output ends with `[...truncated]`.
- This prevents accidental secret leakage through large output and keeps the LLM context manageable.

**Security properties:**
- Secret is injected as an environment variable — never in command arguments.
- Secret never appears in the tool response.
- Subprocess output (stdout/stderr) may contain sensitive data — the truncation limit mitigates but does not eliminate this risk.
- Every execution is audited with `access.mount_env`.

**Example interaction:**

```
AI: I need to deploy this package to npm. Let me use the npm token.

→ run_with_secret({
    itemId: "npm-token-id",
    command: "npm",
    args: ["publish", "--access", "public"],
    envVarName: "NPM_TOKEN",
    purpose: "Publish package v2.1.0 to npm"
  })

← { exitCode: 0, stdout: "+ my-package@2.1.0", stderr: "" }

AI: Package published successfully as v2.1.0.
```

---

### mount_secret

Mount a secret as a temporary file with restricted permissions. Returns the file path, never the content.

**Use case:** For tools that require file-based credentials (SSH keys, TLS certificates, service account JSON files).

```
Tool: mount_secret
Input:
{
  "itemId": string,        // Required. Item to mount.
  "filename": string,      // Optional. Custom filename (default: item ID).
  "purpose": string        // Optional. Why this credential is needed (for audit).
}

Output:
{
  "path": "/tmp/abadge-xxxxx/secret",
  "permissions": "0600",
  "message": "Secret mounted. File will be auto-cleaned after 5 minutes."
}
```

**Security properties:**
- File is created with mode `0600` (owner read/write only).
- File is automatically deleted after **5 minutes**.
- File path is safe to share with the LLM — the LLM cannot read the file directly.
- Every mount is audited with `access.mount_file`.

**Auto-cleanup:** A timer deletes the file after 5 minutes. If the MCP server process exits, the file remains until the OS cleans the temp directory.

**Example interaction:**

```
AI: I need to SSH into the production server. Let me mount the SSH key.

→ mount_secret({
    itemId: "prod-ssh-key",
    filename: "id_rsa",
    purpose: "SSH into prod server for log collection"
  })

← { path: "/tmp/abadge-a1b2c3/id_rsa", permissions: "0600", message: "..." }

→ run_with_secret({
    itemId: "...",
    command: "ssh",
    args: ["-i", "/tmp/abadge-a1b2c3/id_rsa", "user@prod.example.com", "tail -100 /var/log/app.log"],
    purpose: "Collect recent logs from production"
  })
```

---

### get_audit

Fetch recent audit log entries.

**Use case:** Let the AI agent review its own access history or check for suspicious activity.

```
Tool: get_audit
Input:
{
  "itemId": string,    // Optional. Filter by item.
  "limit": number      // Optional. Max entries (1-100, default 20).
}

Output:
{
  "entries": [
    {
      "id": number,
      "userId": "string",
      "agentId": "string | null",
      "itemId": "string | null",
      "eventType": "access.mount_env",
      "result": "allowed",
      "deliveryMode": "mount_env",
      "meta": {},
      "ipAddress": "string | null",
      "occurredAt": "ISO 8601"
    }
  ]
}
```

**Security:** Audit data is metadata — no secret values are included.

---

## Error Handling

When a tool encounters an error, it returns an MCP error response:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "Error: PERMISSION_DENIED — No mount_env permission for item a1b2c3d4"
    }
  ]
}
```

Common error scenarios:

| Scenario | Error message |
|----------|--------------|
| No permission | `PERMISSION_DENIED — No {capability} permission for item {id}` |
| Permission expired | `PERMISSION_EXPIRED — Permission for item {id} has expired` |
| Agent revoked | `AGENT_REVOKED — Agent is revoked` |
| Daemon not running | `Daemon not running (required for zero-knowledge items)` |
| Vault locked | `Vault is locked — run 'abadge vault unlock' first` |
| Item not found | `ITEM_NOT_FOUND — Item {id} not found` |
| Rate limited | `RATE_LIMITED — Too many requests` |

---

## Design Decisions

### Why only `mount_env` and `mount_file` capabilities?

The MCP server intentionally does not expose `reveal_plaintext` or `read_ciphertext`:

- `reveal_plaintext` would return the secret directly to the LLM context — violating the "never expose secrets to LLMs" invariant.
- `read_ciphertext` returns encrypted data that is useless to the LLM and would waste context.

The only useful delivery modes for AI agents are `mount_env` (inject into subprocess) and `mount_file` (write to temp file). Both allow the agent to **use** the secret without **seeing** it.

### Why truncate output to 4 KB?

Two reasons:
1. **Security:** Long subprocess output might contain secrets (e.g., a debug log that prints environment variables). Truncation limits exposure.
2. **Context efficiency:** LLM context windows are expensive. A 10 MB build log is unhelpful — the agent needs the exit code and a summary.

### Why 5-minute auto-cleanup for mounted files?

Balances usability and security:
- Too short (30s): multi-step workflows fail.
- Too long (1h): forgotten temp files accumulate.
- 5 minutes: covers typical tool invocations with margin.

### Why `purpose` fields?

The `purpose` parameter in `request_access`, `run_with_secret`, and `mount_secret` serves two functions:
1. **Audit trail enrichment:** The purpose is stored in the audit log's `meta` field, providing context for security reviews.
2. **Future approval workflows:** If a policy requires human approval, the purpose gives the approver context for the request.

The purpose is optional today but recommended. AI agents should always provide it.
