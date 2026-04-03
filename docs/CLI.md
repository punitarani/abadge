# CLI Reference

The `abadge` CLI has two auth personas:

* **operator** commands use a Better Auth device-login session held only in the local daemon
* **runtime** commands use a provisioned local agent keypair and short-lived `abs_...` sessions

## Installation

```bash
bun run cli -- --help
bun packages/cli/bin/abadge.ts --help
```

Standalone binary:

```bash
bun run release:cli:dry-run -- --outdir /tmp/abadge-cli-release
```

Release dry-run:

```bash
bun run release:cli:dry-run -- --outdir /tmp/abadge-cli-release
```

Public installer:

```bash
curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
```

See [`docs/release/cli.md`](./release/cli.md) for the package-scoped release flow.

## Configuration

Config lives at `~/.abadge/config.json`.

It stores durable metadata only:

```json
{
  "apiUrl": "http://localhost:8787",
  "operatorUserId": "user_...",
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

No human session bearer token is persisted in the config file.
Saved local agent references are reused only for the same operator on the same API origin. A
fresh login reprovisions them when either changes.

The local daemon socket is `~/.abadge/vaultd.sock`.

## Commands

### `abadge login`

Starts Better Auth device authorization.

Flow:

1. request device and user codes from `/api/auth/device/code`
2. open the browser to the verification URL when possible
3. poll `/api/auth/device/token`
4. store the resulting operator session only in the daemon
5. provision local `local_cli` and `local_mcp` keypair-backed agents when missing

```bash
abadge login
abadge login --api-url http://localhost:8787
abadge login --no-open-browser
```

### `abadge logout`

Clears the daemon-held operator session.

```bash
abadge logout
```

### `abadge daemon start`

Starts the local daemon if it is not already running.

```bash
abadge daemon start
```

### `abadge daemon status`

Prints daemon runtime state.

```bash
abadge daemon status
```

### `abadge daemon stop`

Stops the local daemon and removes the live socket.

```bash
abadge daemon stop
```

### `abadge vault unlock`

Prompts for the master password and unlocks the local vault in daemon memory.

```bash
abadge vault unlock
```

### `abadge vault lock`

Clears the unlocked vault state and the daemon-held operator session.

```bash
abadge vault lock
```

### `abadge vault status`

Prints whether the daemon currently has an unlocked vault.

```bash
abadge vault status
```

### `abadge vault change-password`

Changes the wrapped vault root key through the daemon and control plane.

```bash
abadge vault change-password
```

### `abadge item create`

Interactive item creation. The CLI encrypts through the daemon and creates a zero-knowledge item.

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

Fetches one item. For zero-knowledge items, the CLI attempts local daemon decryption.

```bash
abadge item get <item-id>
abadge item get <item-id> --reveal
```

### `abadge item update <id>`

Updates an item interactively.

```bash
abadge item update <item-id>
```

### `abadge item update <id>`

Replaces an item body with optimistic concurrency.

```bash
abadge item update <item-id>
abadge item update <item-id> --json
```

### `abadge item delete <id>`

Soft-deletes an item.

```bash
abadge item delete <item-id>
abadge item delete <item-id> --force
```

### `abadge agent register`

Registers a new agent.

Defaults:

* auth method: `public_key_session`
* remote agents receive a one-time bootstrap token
* legacy API keys are opt-in

```bash
abadge agent register --name "ci bot" --kind remote_agent
abadge agent register --name "legacy worker" --kind remote_agent --legacy-api-key
abadge agent register --name "dev laptop" --kind local_cli --json
```

Flags:

| Flag | Description |
|------|-------------|
| `--name, -n` | Agent display name |
| `--kind, -k` | Agent kind |
| `--description, -d` | Optional metadata description |
| `--legacy-api-key` | Create a deprecated `abl_` / `abg_` API-key agent |
| `--no-bootstrap-token` | Skip bootstrap-token issuance for keypair-backed agents |
| `--json` | Print raw JSON |

### `abadge agent enroll`

Redeems a one-time bootstrap token, generates a local Ed25519 keypair, writes the private key with
`0600` permissions, and uploads only the public key.

```bash
abadge agent enroll --bootstrap-token abe_...
abadge agent enroll --bootstrap-token abe_... --private-key-path ~/.abadge/agents/remote.jwk
```

### `abadge agent list`

Lists registered agents.

```bash
abadge agent list
abadge agent list --json
```

### `abadge agent rotate <id>`

Rotates a legacy agent API key only.

```bash
abadge agent rotate <agent-id>
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

Uses the local `local_cli` agent identity, exchanges a short-lived `abs_...` session, resolves the
item through the access path, and injects the secret into a subprocess through the daemon.

```bash
abadge run --item <item-id> -- npm run deploy
abadge run --item <item-id> --env-var OPENAI_API_KEY -- node script.js
```

The injected environment variable name is currently fixed to `ABADGE_SECRET`.

### `abadge mount`

Uses the local `local_cli` agent identity, exchanges a short-lived `abs_...` session, resolves the
item through the access path, and asks the daemon to mount it as a temporary file.

```bash
abadge mount --item <item-id>
abadge mount --item <item-id> --path /tmp/my-secret.txt
```

### `abadge audit`

Fetches the recent audit log.

```bash
abadge audit
abadge audit --json
```
