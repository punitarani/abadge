# MCP Server

The abadge MCP server (`abadge-mcp`) exposes item-aware tools to AI agents
without returning secret values to the model. It runs as a subprocess MCP
server over stdio.

## Install

```bash
# CLI + MCP server
curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash

# MCP only
ABADGE_INSTALL_PACKAGE=mcp \
  curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
```

See [docs/release/mcp.md](release/mcp.md) for the underlying release flow.

## Setup

### Authentication

The MCP server authenticates with an Ed25519 keypair session — the only
method:

```bash
export ABADGE_API_URL=http://localhost:8787
export ABADGE_AGENT_ID=agt_...
export ABADGE_PRIVATE_KEY_PATH=~/.abadge/agents/mcp.ed25519.jwk
```

The server performs an Ed25519 session exchange lazily on the first tool
invocation and refreshes the session at T-2 minutes before expiry.

Instead of a key file, an inline JWK string may be supplied via
`ABADGE_PRIVATE_KEY`. Exactly one of `ABADGE_PRIVATE_KEY_PATH` or
`ABADGE_PRIVATE_KEY` is required.

When the CLI and MCP server share a machine but authenticate as different
agents, the MCP-only overrides `ABADGE_MCP_AGENT_ID` and
`ABADGE_MCP_PRIVATE_KEY` take precedence over the generic variables.

`~/.abadge/config.json` is also read for these values (top-level `apiUrl`,
`agentId`, `privateKeyPath`); environment variables take precedence. The
MCP server has no other auth method — agents authenticate only via Ed25519
keypair sessions.

### Running

```bash
abadge-mcp                  # installed binary
bun run mcp                 # dev (monorepo)
```

## Claude Desktop / MCP client config

The CLI can emit a paste-ready snippet:

```bash
abadge agent add --kind local_mcp --name claude-desktop --mcp-config
```

Shape:

```json
{
  "mcpServers": {
    "abadge": {
      "command": "/Users/you/.abadge/bin/abadge-mcp",
      "env": {
        "ABADGE_API_URL": "https://api.abadge.io",
        "ABADGE_AGENT_ID": "agt_...",
        "ABADGE_PRIVATE_KEY_PATH": "/Users/you/.abadge/agents/agt_....ed25519.jwk"
      }
    }
  }
}
```

Use the absolute path for `command` — Claude Desktop launches with a
minimal `$PATH` that does not include `~/.abadge/bin`.

## Tool reference

The MCP server registers five tools.

### `list_items`

Lists stored item metadata (id, label, storageMode, cryptoVersion,
contentVersion, profileId, timestamps). `kind` and field values live in
the encrypted payload and are never returned. Never returns secret values.

Input: none.
Output: JSON object with an `items` array of item summaries.

### `use_secret`

The unified runtime tool. Runs a command with one secret, or with every
env-var-shaped secret in a profile, injected as environment variables.
Returns only the exit code, duration, output-line count, and a
truncation flag. **Subprocess stdout/stderr text is never returned to the
model.**

Provide exactly one target field. The two targets are mutually exclusive:

| Field | Mode | Selects |
|-------|------|---------|
| `itemId` | single-item | one item by id |
| `profileId` | bulk | every env-shaped item in the profile, by profile id |

Common fields:

| Input field | Type | Required | Description |
|------|------|----------|-------------|
| `command` | string | yes | Command to run |
| `args` | string[] | no | Command arguments |
| `purpose` | string | no | Why this credential is needed (audited) |
| `field` | string | no | Named field (single-item mode only) |
| `envVarName` | string | no | Env var name (single-item mode only; default `ABADGE_SECRET`) |

Output:

```json
{
  "exitCode": 0,
  "durationMs": 42,
  "outputLineCount": { "stdout": 2, "stderr": 0 },
  "truncated": false,
  "injectedCount": 7
}
```

`injectedCount` is present only in bulk mode.

On a failed run (`exitCode !== 0`) that produced withheld output, the result
also carries a static, secret-free `hint` string explaining that stdout/stderr
were suppressed per §RED1 and pointing at `mount_secret` for output inspection.
The hint is a fixed constant containing no subprocess output, and is omitted
entirely on success.

Security:

* Output text is captured for line counting only — never forwarded to
  the model. Eliminates semantic-leakage vectors (base64, hex,
  URL-encoded, nth-char extraction, byte-split) that string-based
  redaction cannot catch (§RED1).
* Per-secret 4 KB size cap; oversize secrets are refused before spawn —
  use `mount_secret` for large credentials (PEMs, kubeconfigs).
* Each stream is bounded to 8 KB to prevent OOM.
* Bulk mode rules:
  * Only single-string-field items participate; multi-field items are
    silently skipped.
  * Labels normalizing to the same env var (or to reserved keys like
    `LD_PRELOAD`, `NODE_OPTIONS`) are hard-rejected.
  * Each included item produces its own `access.use` audit row.
* Bulk mode is local-only (`use` is unavailable to remote agents).

### `mount_secret`

Mounts a secret as a temporary file with `0600` permissions. Returns an
opaque `mountId` — **the file path is never returned to the model**. The
file auto-deletes after 5 minutes, or earlier with `release_mount`.

| Input field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | yes | Item to mount |
| `field` | string | no | Named field for multi-field items |
| `filename` | string | no | Custom filename (default: item ID) |
| `purpose` | string | no | Why this credential is needed |

Output:

```json
{ "mountId": "3a8f1c...", "permissions": "0600", "expiresIn": "5 minutes" }
```

### `release_mount`

Releases a mount by `mountId`, deleting the temp file immediately.

| Input field | Type | Required | Description |
|------|------|----------|-------------|
| `mountId` | string | yes | Opaque mount ID from `mount_secret` |

Output: `{ "released": true, "mountId": "..." }`.

### `get_audit`

Fetches recent audit entries from the control plane.

| Input field | Type | Required | Description |
|------|------|----------|-------------|
| `itemId` | string | no | Filter to one item |
| `limit` | number | no | Max entries (1–100; server default ~20) |

Output: JSON object with an `entries` array.

## Error responses

Tool errors are JSON text content:

```json
{
  "error": "Human-readable message",
  "code": "DOMAIN_CODE",
  "hint": "Remediation",
  "meta": { }
}
```

`error` is always present. `code`, `hint`, and `meta` are populated when
the underlying failure is an `AbadgeApiError`. LLM integrators can parse
`code` for deterministic branching.

## Startup behavior

On startup the server scans the OS temp directory for orphaned `abadge-*`
mount directories older than 10 minutes and removes them.

## Keypair session lifecycle

On the first tool invocation the MCP server:

1. Creates an anonymous API client.
2. Requests an agent challenge (`abc_...`, 60 s TTL).
3. Signs the challenge with the configured Ed25519 private key.
4. Exchanges the signature for a short-lived `abs_...` session (15 min TTL).
5. Schedules automatic session refresh at T-2 min before expiry.

## Security model

The MCP server treats the model as untrusted:

| Guarantee | How it is enforced |
|---|---|
| Secrets never enter model context | `list_items` returns metadata only; `use_secret` returns only the redacted shape; `mount_secret` returns only an opaque `mountId` |
| Output never returned to model | `use_secret` captures stdout/stderr internally; only line counts and a truncation flag are returned |
| Pre-spawn size cap | Each secret must fit in 4 KB before spawn; larger secrets are refused |
| Opaque mount IDs | File paths are never returned; mount IDs are random hex tokens |
| Restricted file permissions | Mounted files use mode `0600` inside a `0700` temp directory |
| Auto-cleanup | Mounted files are deleted after 5 minutes; orphans are swept on startup |
| No raw-secret tool | No tool returns the raw secret bytes to the model |

For zero-knowledge items the MCP server delegates decryption to the local
daemon, which holds the profile root key in memory.
