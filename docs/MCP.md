# MCP Server

The abadge MCP server exposes item-aware tools to local AI agents without returning raw secrets to
the model by default.

## Setup

Provide configuration through environment variables or `~/.abadge/config.json`:

```bash
export ABADGE_API_URL=http://localhost:8787
export ABADGE_TOKEN=abl_your_local_principal_key
```

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
        "ABADGE_TOKEN": "abl_your_local_principal_key"
      }
    }
  }
}
```

## Tool reference

### `list_items`

Lists stored item metadata.

Input: `{}`

Output:

```json
{ "items": [{ "id": "...", "storageMode": "zero_knowledge", "createdAt": "...", "updatedAt": "..." }] }
```

### `request_access`

Checks whether the caller can use an item through a mount-style capability. For zero-knowledge
items, the tool also verifies that local daemon decryption is possible.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |
| `capability` | `"mount_env" \| "mount_file"` | yes | Requested capability |
| `purpose` | string | no | Free-form reason |

Successful output:

```json
{ "status": "granted", "itemId": "...", "capability": "mount_env" }
```

Failure output:

```json
{ "status": "denied", "error": "..." }
```

### `run_with_secret`

Resolves an item and injects it into a subprocess without returning the secret to the model.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |
| `command` | string | yes | Executable to run |
| `args` | string[] | no | Command arguments |
| `envVarName` | string | no | Environment variable name. Defaults to `ABADGE_SECRET` |
| `purpose` | string | no | Free-form reason |

Output:

```json
{ "exitCode": 0, "stdout": "...", "stderr": "..." }
```

Stdout and stderr are truncated to 4 KB each.

### `mount_secret`

Mounts an item into a temporary file and returns the file path only.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Target item |
| `filename` | string | no | Output filename inside the temp directory |
| `purpose` | string | no | Free-form reason |

Output:

```json
{
  "path": "/tmp/abadge-.../secret.txt",
  "permissions": "0600",
  "message": "Secret mounted. File will be auto-cleaned after 5 minutes."
}
```

### `get_audit`

Fetches recent audit entries from the control plane.

| Field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | no | Filter by item |
| `limit` | number | no | Maximum entries, `1..100` |

Output:

```json
{ "entries": [{ "id": 1, "eventType": "access.mount_env", "result": "allowed" }] }
```

## Security model

The MCP server treats the model as untrusted:

* `list_items` returns metadata only
* `request_access` returns status only
* `run_with_secret` exposes command output, not the secret
* `mount_secret` exposes a file path, not the secret
* there is no tool that returns raw secret bytes directly to the model

The MCP server authenticates with a local agent token, uses the shared tRPC client for control
plane access, and delegates zero-knowledge decrypt work to the local daemon.
