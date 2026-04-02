# CLI Reference

The `abadge` CLI is the primary developer and operator interface for the credential control plane.

## Installation

```bash
# From the monorepo (development)
bun run cli -- --help

# Or directly
bun packages/cli/bin/abadge.ts --help
```

### Standalone binary

The CLI can be compiled into a standalone binary using Bun's `--compile` flag. No Bun or Node.js runtime is required on the target machine.

```bash
cd apps/cli
bun run build    # outputs dist/abadge
./dist/abadge --help
```

## Configuration

Config is stored at `~/.abadge/config.json`:

```json
{
  "apiUrl": "http://localhost:8787",
  "token": "..."
}
```

Created automatically by `abadge login`.

The local vault daemon communicates via Unix socket at `~/.abadge/vaultd.sock`.

## Commands

### `abadge login`

Authenticate and store credentials.

```bash
abadge login --api-url http://localhost:8787
# Prompts for email and password
```

### `abadge vault unlock`

Unlock the local vault daemon with your master password.

```bash
abadge vault unlock
# Prompts for master password
```

### `abadge vault lock`

Lock the vault daemon (clears root key from memory).

```bash
abadge vault lock
```

### `abadge vault status`

Check vault daemon status (initialized, locked, item count).

```bash
abadge vault status
```

### `abadge vault change-password`

Change the vault master password.

```bash
abadge vault change-password
```

### `abadge item create`

Store a new item in the vault.

```bash
abadge item create \
  --label github-token \
  --kind api_key \
  --value ghp_abc123
```

For zero-knowledge items, the CLI encrypts client-side via the daemon before sending to the API. For server-managed items, the value is sent to the API for server-side encryption.

### `abadge item list`

List all items (metadata only, never values).

```bash
abadge item list
abadge item list --json
```

### `abadge item get <id>`

Get item metadata.

```bash
abadge item get <item-id>
abadge item get <item-id> --json
```

### `abadge item delete <id>`

Soft delete an item.

```bash
abadge item delete <item-id>
```

### `abadge principal register`

Register a new principal (device, CLI, MCP server, or remote agent).

```bash
abadge principal register --kind local_cli --name "dev laptop"
abadge principal register --kind remote_agent --name "ci-bot"
```

The API key is shown **once** and never retrievable again.

### `abadge principal list`

List registered principals.

```bash
abadge principal list
abadge principal list --json
```

### `abadge principal revoke <id>`

Revoke a principal's access.

```bash
abadge principal revoke <principal-id>
```

### `abadge grant create`

Grant a principal a capability on an item.

```bash
abadge grant create --principal <id> --item <id> --capability reveal_plaintext
abadge grant create --principal <id> --item <id> --capability mount_env
```

### `abadge grant list`

List grants.

```bash
abadge grant list --item <item-id>
abadge grant list --principal <principal-id>
```

### `abadge grant revoke <id>`

Revoke a grant.

```bash
abadge grant revoke <grant-id>
```

### `abadge run`

Run a command with a secret injected as an environment variable. The secret is never written to disk or printed to stdout.

```bash
abadge run --item <item-id> -- npm run deploy
abadge run --item <item-id> --env-var GITHUB_TOKEN -- npm run deploy
```

How it works:

1. Authenticates with the API or daemon
2. For ZK items: daemon decrypts locally
3. For server-managed items: requests via access API
4. Spawns the child process with the secret injected as an env var
5. Forwards the child's exit code
6. Secret never touches disk or stdout

### `abadge mount`

Mount a secret as a temporary file with restricted permissions (0600).

```bash
abadge mount --item <item-id> --path /tmp/cert.pem
```

The file is deleted when you press Enter or Ctrl+C.

### `abadge audit`

View the access audit log.

```bash
abadge audit
abadge audit --limit 50
abadge audit --json
```

### `abadge daemon start`

Start the local vault daemon.

```bash
abadge daemon start
```

### `abadge daemon stop`

Stop the local vault daemon.

```bash
abadge daemon stop
```

## Global options

| Flag | Description |
|------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
| `--json` | Machine-readable JSON output |
