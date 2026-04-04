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

Config lives at `~/.abadge/config.json`. The CLI stores a user session for control-plane commands
and a local CLI agent key for principal-authenticated access commands:

```json
{
  "apiUrl": "http://localhost:8787",
  "sessionCookie": "...",
  "principalId": "agt_...",
  "principalSecret": "abg_..."
}
```

The config file is written with `0600` permissions. The session cookie and local CLI agent secret are
stored in plaintext in that file, so treat it like an auth credential.

The local daemon socket is `~/.abadge/vaultd.sock`.

## Commands

### `abadge login`

Interactive email/password login. Stores `apiUrl`, the Better Auth session cookie, and ensures a
reusable local CLI agent exists for `run` and `mount`.

```bash
abadge login --api-url http://localhost:8787
abadge login --api-url http://localhost:8787 --email user@example.com --password password123
```

Prefer the interactive password prompt. `--password` is supported for automation, but it exposes the
password to shell history and process listings.

### `abadge daemon start`

Starts the local daemon process if it is not already running. The CLI spawns the current `abadge`
entrypoint in an internal daemon-serve mode, so the same command works in development and in a
compiled binary.

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

Prompts for the current password and the replacement password, then updates the wrapped vault key
through the daemon and control plane.

```bash
abadge vault change-password
```

### `abadge item create`

Creates a new item. Zero-knowledge items are encrypted locally through the daemon. Server-managed
items are sent as payloads to the control plane.

```bash
abadge item create
abadge item create --label "OpenAI" --kind api_key --value sk-... --storage-mode zero_knowledge
abadge item create --label "Deploy token" --kind token --value abc --storage-mode server_managed
```

Flags:

| Flag | Description |
|------|-------------|
| `--name`, `--label` | Item label |
| `--kind` | Item kind |
| `--value` | Secret value |
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

Creates a new agent and prints the one-time API key.

```bash
abadge agent register --name "dev laptop" --kind local_cli
abadge agent register --name "ci bot" --kind remote_agent --description "deploy runner"
```

Flags:

| Flag | Description |
|------|-------------|
| `--name, -n` | Agent display name |
| `--kind, -k` | Agent kind |
| `--description, -d` | Optional metadata description |
| `--json` | Print raw JSON |

### `abadge agent list`

Lists registered agents.

```bash
abadge agent list
abadge agent list --json
```

### `abadge agent rotate <id>`

Rotates an agent API key and prints the new one-time key.

```bash
abadge agent rotate <agent-id>
abadge agent rotate <agent-id> --json
```

### `abadge agent revoke <id>`

Revokes an agent.

```bash
abadge agent revoke <agent-id>
```

### `abadge permission create`

Creates an explicit permission.

```bash
abadge permission create --agent-id <agent-id> --item-id <item-id> --capability mount_env
abadge permission create --agent-id <agent-id> --item-id <item-id> --capability reveal_plaintext
```

Flags:

| Flag | Description |
|------|-------------|
| `--agent-id` | Target agent |
| `--item-id` | Target item |
| `--capability` | Allowed capability |
| `--expires-at` | Optional ISO timestamp expiry |
| `--json` | Print raw JSON |

### `abadge permission list`

Lists permissions.

```bash
abadge permission list
abadge permission list --agent-id <agent-id>
abadge permission list --item-id <item-id>
abadge permission list --json
```

### `abadge permission revoke <id>`

Revokes a permission.

```bash
abadge permission revoke <permission-id>
```

### `abadge run`

Resolves a secret value, injects it into a subprocess through the daemon, and exits with the child
process exit code.

```bash
abadge run --item <item-id> -- npm run deploy
abadge run --item <item-id> --env-var OPENAI_API_KEY -- node script.js
```

Notes:

* defaults to `ABADGE_SECRET`
* zero-knowledge items are decrypted locally through the daemon
* server-managed items are fetched through the access router first

### `abadge mount`

Resolves a secret and asks the daemon to mount it as a temporary file.

```bash
abadge mount --item <item-id>
abadge mount --item <item-id> --path /tmp/my-secret.txt
```

The daemon chooses the file path and the CLI prints it.

### `abadge audit`

Fetches the recent audit log.

```bash
abadge audit
abadge audit --limit 100
abadge audit --cursor <cursor>
abadge audit --json
```

Flags:

| Flag | Description |
|------|-------------|
| `--limit` | Maximum number of entries to return |
| `--cursor` | Pagination cursor from a previous response |
| `--json` | Print raw JSON |

## Global options

| Flag | Description |
|------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
| `--json` | Print machine-readable output on commands that support it |
