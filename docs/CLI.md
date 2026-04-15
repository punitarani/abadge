# CLI Reference

The `abadge` CLI is the local operator interface for the control plane and the vault daemon.

## Installation

```bash
# Development entrypoint
bun run cli -- --help

# Direct TypeScript entrypoint
bun packages/cli/bin/abadge.ts --help
```

### Compiled binary

```bash
bun run release:cli:dry-run -- --outdir /tmp/abadge-cli-release
```

### Public installer

```bash
curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
```

See [`docs/release/cli.md`](./release/cli.md) for the release and installer flow.

## Configuration

Config lives at `~/.abadge/config.json`. Key fields:

```json
{
  "apiUrl": "http://localhost:8787",
  "activeOrgId": "org_...",
  "activeProfileId": "prof_...",
  "localAgents": {
    "cli": { "agentId": "agent_...", "privateKeyPath": "~/.abadge/agents/cli.ed25519.jwk" },
    "mcp": { "agentId": "agent_...", "privateKeyPath": "~/.abadge/agents/mcp.ed25519.jwk" }
  }
}
```

No API keys are stored in config. The bearer session token is held in daemon memory only and is never written to disk. Agent private keys live in protected files (0600) under `~/.abadge/agents/`.

The local daemon socket is `~/.abadge/vaultd.sock`.

## Commands

### `abadge login`

Device-code login. Opens the approval URL in the browser, then stores `apiUrl` in config and holds
the Better Auth bearer token in daemon memory. Does not auto-register an agent.

```bash
abadge login
abadge login --api-url http://localhost:8787
```

After logging in, register an agent explicitly with `abadge agent register`.

### `abadge logout`

Logs out the current session, audits the event, and clears local config.

```bash
abadge logout
```

### `abadge daemon start`

Starts the local daemon process if it is not already running.

```bash
abadge daemon start
```

### `abadge daemon status`

Prints daemon runtime state.

```bash
abadge daemon status
```

### `abadge daemon stop`

Stops the local daemon process and removes the live socket.

```bash
abadge daemon stop
```

### `abadge vault unlock`

Prompts for the master password and unlocks the local vault in daemon memory.

```bash
abadge vault unlock
```

### `abadge vault lock`

Clears the unlocked vault state from the daemon.

```bash
abadge vault lock
```

### `abadge vault status`

Prints whether the daemon currently has an unlocked vault.

```bash
abadge vault status
```

### `abadge vault change-password`

Prompts for the current and new password, then re-wraps the vault key.

```bash
abadge vault change-password
```

### `abadge org create`

Creates a new organization.

```bash
abadge org create --name "Acme"
```

| Flag | Description |
|------|-------------|
| `--name, -n` | Organization display name |
| `--json` | Print raw JSON |

### `abadge org list`

Lists organizations the current user belongs to.

```bash
abadge org list
abadge org list --json
```

### `abadge org use <id>`

Sets the active organization for subsequent commands.

```bash
abadge org use org_...
```

### `abadge org members`

Lists members of the active organization.

```bash
abadge org members
```

### `abadge profile create`

Creates a new credential profile within the active organization.

```bash
abadge profile create --name "production"
abadge profile create --name "staging" --storage-mode server_managed
```

| Flag | Description |
|------|-------------|
| `--name, -n` | Profile display name |
| `--storage-mode` | `zero_knowledge` or `server_managed` |
| `--json` | Print raw JSON |

### `abadge profile list`

Lists profiles in the active organization.

```bash
abadge profile list
abadge profile list --json
```

### `abadge profile use <name>`

Sets the active profile for subsequent item commands.

```bash
abadge profile use production
```

### `abadge item create`

Creates a new item. Zero-knowledge items are encrypted locally through the daemon. Server-managed
items are sent as payloads to the control plane.

```bash
abadge item create
abadge item create --label "OpenAI" --kind api_key --storage-mode server_managed
abadge item create --label "Deploy SSH key" --kind ssh_key --storage-mode zero_knowledge
```

Flags:

| Flag | Description |
|------|-------------|
| `--name`, `--label` | Item label |
| `--kind` | Item kind (`opaque`, `api_key`, `login`, `token`, `ssh_key`, `certificate`, `json`) |
| `--value` | Secret value (rejected on TTY to prevent shell history leaks; pipe from stdin instead) |
| `--storage-mode` | `zero_knowledge` or `server_managed` |
| `--json` | Print raw JSON |

### `abadge item list`

Lists item metadata only.

```bash
abadge item list
abadge item list --json
```

### `abadge item get <id>`

Fetches one item. Use `--reveal` to decrypt a zero-knowledge item locally through the daemon.

```bash
abadge item get <item-id>
abadge item get <item-id> --reveal
```

### `abadge item update <id>`

Updates an item interactively.

```bash
abadge item update <item-id>
```

### `abadge item delete <id>`

Soft-deletes an item. Use `-f` or `--force` to skip confirmation.

```bash
abadge item delete <item-id>
abadge item delete <item-id> --force
```

### `abadge agent register`

Registers a new agent (does not auto-run on login). Defaults to keypair auth
(`public_key_session`): generates an Ed25519 keypair on-device, stores the private key in
`~/.abadge/agents/`, and uploads the public key via bootstrap token. Use `--legacy-api-key`
to opt into legacy API key auth instead (shows the key once, warns about deprecation).

```bash
abadge agent register --kind local_cli
abadge agent register --name "ci bot" --kind remote
abadge agent register --name "legacy bot" --kind remote --legacy-api-key
```

| Flag | Description |
|------|-------------|
| `--name, -n` | Agent display name |
| `--kind, -k` | `local_cli`, `local_mcp`, or `remote` |
| `--description, -d` | Optional metadata description |
| `--legacy-api-key` | Opt into legacy API key auth instead of keypair session |
| `--json` | Print raw JSON |

### `abadge agent list`

Lists registered agents.

```bash
abadge agent list
abadge agent list --json
```

### `abadge agent rotate <id>`

Rotates an agent API key (legacy API key agents only) and prints the new one-time key.

```bash
abadge agent rotate <agent-id>
```

### `abadge agent revoke <id>`

Revokes an agent and invalidates all active sessions.

```bash
abadge agent revoke <agent-id>
```

### `abadge permission create`

Creates an explicit permission createing a capability to an agent for an item.

```bash
abadge permission create --agent <agent-id> --item <item-id> --capability reveal_plaintext
abadge permission create --agent <agent-id> --item <item-id> --capability mount_env
abadge permission create --agent <agent-id> --item <item-id> --capability mount_env --expires-at 2026-12-31T00:00:00Z
```

| Flag | Description |
|------|-------------|
| `--agent`, `--agent-id` | Target agent |
| `--item`, `--item-id` | Target item |
| `--capability` | `read_ciphertext`, `reveal_plaintext`, `mount_env`, or `mount_file` |
| `--expires-at` | Optional ISO timestamp expiry |
| `--json` | Print raw JSON |

### `abadge permission list`

Lists permissions, optionally filtered.

```bash
abadge permission list
abadge permission list --agent-id <agent-id>
abadge permission list --item-id <item-id>
abadge permission list --json
```

### `abadge permission revoke <id>`

Revokes a permission immediately.

```bash
abadge permission revoke <permission-id>
```

### `abadge run`

Resolves a secret value and injects it into a subprocess via the daemon. Exits with the child
process exit code. Supports field-level delivery for multi-field items and environment expansion.

```bash
# Single-value item — inject as ABADGE_SECRET
abadge run --item <item-id> -- npm run deploy

# Inject a specific field from a multi-field item
abadge run --item <item-id> --field password --env-var DB_PASSWORD -- psql "$DB_HOST"

# Inject as a named env var
abadge run --item <item-id> --env-var OPENAI_API_KEY -- node script.js

# Multiple fields from one item (stacked triples)
abadge run --item prod-db --field username --env-var DB_USER \
           --field password --env-var DB_PASSWORD -- ./migrate.sh

# Expand every field of a multi-field item into the environment
abadge run --item my-service-env --expand-env -- ./server
# → DATABASE_URL=..., REDIS_URL=..., API_KEY=... (field name = env var name)
```

| Flag | Description |
|------|-------------|
| `--item` | Item ID or label |
| `--field` | Named field to inject (for multi-field items); can be repeated |
| `--env-var` | Environment variable name (default: `ABADGE_SECRET`) |
| `--expand-env` | Inject every field as a separate env var (field name = var name) |

### `abadge mount`

Resolves a secret and asks the daemon to mount it as a temporary file (0600 permissions).

```bash
abadge mount --item <item-id>
abadge mount --item <item-id> --field private_key
abadge mount --item <item-id> --path /tmp/my-secret.txt
```

The daemon chooses the file path; the CLI prints it for use in subsequent commands.

### `abadge import <file>`

Imports secrets from an `.env` file, creating one server-managed item per variable. Pass `--overwrite` to update existing items (matched by label). Without it, existing labels are skipped with a warning. `--overwrite` refuses to touch zero-knowledge items — delete and re-import, or use `abadge item update`.

The summary line reports five buckets: `created`, `updated`, `skipped` (existed without `--overwrite`), `refused` (zero-knowledge item under `--overwrite`), `failed` (API error during write). The CLI exits non-zero when `failed > 0`; `skipped` and `refused` are intentional outcomes and do not flip the exit code.

```bash
abadge import .env
abadge import secrets.env --kind api_key --overwrite
abadge import .env --dry-run
```

### `abadge export`

Exports items as an `.env` file or JSON. Only works with server-managed items (zero-knowledge items
require local decryption through the daemon).

```bash
abadge export
abadge export --format json
abadge export --format env > secrets.env
```

### `abadge audit`

Fetches the recent audit log.

```bash
abadge audit
abadge audit --json
```

## Global options

| Flag | Description |
|------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
| `--json` | Print machine-readable output on commands that support it |
| `--token-stdin` | Read a bearer session token from stdin for this command |
