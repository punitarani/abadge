# CLI Specification

The `abadge` CLI now uses two distinct auth personas:

* operator commands use a Better Auth device-login session held only in daemon memory
* runtime commands use a local agent keypair plus short-lived `abs_...` agent sessions

## Configuration

Path: `~/.abadge/config.json`

Permissions: `0600`

Stored fields are durable metadata only:

```json
{
  "apiUrl": "http://localhost:8787",
  "operatorUserId": "user_...",
  "profileName": "default",
  "localAgents": {
    "cli": {
      "agentId": "agent_...",
      "privateKeyPath": "/Users/you/.abadge/agents/cli.ed25519.jwk"
    },
    "mcp": {
      "agentId": "agent_...",
      "privateKeyPath": "/Users/you/.abadge/agents/mcp.ed25519.jwk"
    }
  }
}
```

The CLI does not persist a human bearer token in the config file.
Stored local agent references are scoped to the current operator and API URL. The login flow
reprovisions them when either changes.

## Daemon files

| File | Purpose |
|------|---------|
| `~/.abadge/vaultd.sock` | Unix socket for daemon RPC |
| `~/.abadge/vaultd.pid` | Daemon PID file |
| `~/.abadge/agents/*.jwk` | Local Ed25519 private keys for provisioned runtime agents |

## Authentication commands

### `abadge login`

Starts Better Auth device authorization.

```bash
abadge login
abadge login --api-url http://localhost:8787
abadge login --no-open-browser
```

Behavior:

1. request device and user codes from `/api/auth/device/code`
2. print the verification URL and user code
3. open the browser automatically when possible
4. poll `/api/auth/device/token`
5. store the resulting operator session in daemon memory only
6. provision `local_cli` and `local_mcp` keypair-backed agents if missing

### `abadge logout`

Clears the daemon-held operator session and records `auth.logout` when possible.

```bash
abadge logout
```

## Daemon commands

### `abadge daemon start`

Starts the local daemon.

```bash
abadge daemon start
```

### `abadge daemon status`

Prints daemon state, including whether an operator session is currently loaded in memory.

```bash
abadge daemon status
```

### `abadge daemon stop`

Stops the daemon, which also drops any daemon-held operator session and unlocked vault state.

```bash
abadge daemon stop
```

## Vault commands

### `abadge vault unlock`

Prompts for the vault password and unwraps the local root key into daemon memory.

```bash
abadge vault unlock
```

### `abadge vault lock`

Zeros the in-memory root key and clears daemon-held authenticated state.

```bash
abadge vault lock
```

### `abadge vault status`

```bash
abadge vault status
```

### `abadge vault change-password`

Changes the wrapped vault root key through the daemon and API.

```bash
abadge vault change-password
```

## Item commands

### `abadge item create`

Creates a zero-knowledge item using daemon-side encryption.

```bash
abadge item create
```

### `abadge item list`

Lists item metadata only.

```bash
abadge item list
abadge item list --json
```

### `abadge item get <item-id>`

Fetches one item. For zero-knowledge items, the CLI attempts local daemon decryption.

```bash
abadge item get <item-id>
```

### `abadge item update <item-id>`

```bash
abadge item update <item-id>
abadge item update <item-id> --json
```

### `abadge item delete <item-id>`

```bash
abadge item delete <item-id>
abadge item delete <item-id> --force
```

## Agent commands

### `abadge agent register`

Registers an agent.

Defaults:

* `authMethod` is always `public_key_session`
* remote agents receive a one-time `abe_...` bootstrap token unless disabled

```bash
abadge agent register --name "ci bot" --kind remote
abadge agent register --name "dev laptop" --kind local_cli --json
```

Flags:

| Flag | Description |
|------|-------------|
| `--name, -n` | Agent display name |
| `--kind, -k` | Agent kind |
| `--description, -d` | Optional metadata description |
| `--no-bootstrap-token` | Skip one-time bootstrap token issuance |
| `--json` | Print raw JSON |

### `abadge agent enroll`

Redeems a one-time bootstrap token, generates a local Ed25519 keypair, writes the private key with
`0600` permissions, and uploads only the public key.

```bash
abadge agent enroll --bootstrap-token abe_...
abadge agent enroll --bootstrap-token abe_... --private-key-path ~/.abadge/agents/remote.jwk
```

### `abadge agent list`

Lists agents, including auth method.

```bash
abadge agent list
abadge agent list --json
```

### `abadge agent revoke <agent-id>`

```bash
abadge agent revoke <agent-id>
```

## Permission commands

### `abadge permission create`

Creates an explicit permission. Default capability is `mount_env`.

```bash
abadge permission create --agent-id <agent-id> --item-id <item-id>
abadge permission create --agent-id <agent-id> --item-id <item-id> --capability reveal_plaintext
```

### `abadge permission list`

```bash
abadge permission list
abadge permission list --json
```

### `abadge permission revoke <permission-id>`

```bash
abadge permission revoke <permission-id>
```

## Runtime commands

### `abadge run`

Uses the provisioned `local_cli` runtime agent to mint or refresh a short-lived `abs_...` agent
session, then injects the item into a subprocess.

```bash
abadge run --item-id <item-id> -- env
```

### `abadge mount`

Uses the provisioned runtime agent and mounts the item into a temporary file or environment-backed
path without persisting the secret long-term.

```bash
abadge mount --item-id <item-id>
```

## Audit commands

### `abadge audit list`

Lists recent audit entries, including auth lifecycle events.

```bash
abadge audit list
abadge audit list --json
```
