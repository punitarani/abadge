# CLI Reference

The `abadge` CLI is the local operator interface for the control plane and the vault daemon.

## Installation

```bash
# Development
bun run cli -- --help

# Direct entrypoint
bun packages/cli/bin/abadge.ts --help
```

### Standalone binary

```bash
mkdir -p dist
bun build --compile packages/cli/bin/abadge.ts --outfile dist/abadge
./dist/abadge --help
```

## Configuration

Config lives at `~/.abadge/config.json`:

```json
{
  "apiUrl": "http://localhost:8787",
  "token": "..."
}
```

The local daemon socket is `~/.abadge/vaultd.sock`.

## Commands

### `abadge login`

Interactive email/password login. Stores `apiUrl` and the returned Better Auth session token in the
local config.

```bash
abadge login --api-url http://localhost:8787
abadge login --api-url http://localhost:8787 --email user@example.com --password password123
```

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

Interactive item creation. The current CLI path encrypts locally through the daemon and creates a
zero-knowledge item.

```bash
abadge item create
```

Prompts:

* label
* item kind
* secret value

### `abadge item list`

Lists item metadata only.

```bash
abadge item list
abadge item list --json
```

### `abadge item get <id>`

Fetches one item. For zero-knowledge items, the CLI attempts local daemon decryption and prints the
decrypted payload when available.

```bash
abadge item get <item-id>
```

### `abadge item delete <id>`

Soft-deletes an item. Use `-f` or `--force` to skip confirmation.

```bash
abadge item delete <item-id>
abadge item delete <item-id> --force
```

### `abadge principal register`

Creates a new principal and prints the one-time secret.

```bash
abadge principal register --name "dev laptop" --kind local_cli
abadge principal register --name "ci bot" --kind remote_agent --description "deploy runner"
```

Flags:

| Flag | Description |
|------|-------------|
| `--name, -n` | Principal display name |
| `--kind, -k` | Principal kind |
| `--description, -d` | Optional metadata description |
| `--json` | Print raw JSON |

### `abadge principal list`

Lists registered principals.

```bash
abadge principal list
abadge principal list --json
```

### `abadge principal revoke <id>`

Revokes a principal.

```bash
abadge principal revoke <principal-id>
```

### `abadge grant create`

Creates an explicit grant. The default capability is `mount_env`.

```bash
abadge grant create --principal-id <principal-id> --item-id <item-id>
abadge grant create --principal-id <principal-id> --item-id <item-id> --capability reveal_plaintext
```

Flags:

| Flag | Description |
|------|-------------|
| `--principal-id` | Target principal |
| `--item-id` | Target item |
| `--capability` | Capability to grant |
| `--json` | Print raw JSON |

### `abadge grant list`

Lists grants.

```bash
abadge grant list
abadge grant list --json
```

### `abadge grant revoke <id>`

Revokes a grant.

```bash
abadge grant revoke <grant-id>
```

### `abadge run`

Resolves a secret value, injects it into a subprocess through the daemon, and exits with the child
process exit code.

```bash
abadge run --item <item-id> -- npm run deploy
```

Notes:

* the injected environment variable name is currently fixed to `ABADGE_SECRET`
* zero-knowledge items are decrypted locally through the daemon
* server-managed items are fetched through the access router first

### `abadge mount`

Resolves a secret and asks the daemon to mount it as a temporary file.

```bash
abadge mount --item <item-id>
```

The daemon chooses the file path and the CLI prints it.

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
