# CLI Specification

The `abadge` CLI now uses two distinct auth personas:

* operator commands use a device authorization session held only in daemon memory
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

Starts the device authorization flow.

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

## Profile (vault) commands

Profile key operations are local to the daemon (zero-knowledge profiles only).

### `abadge profile unlock`

Prompts for the profile password and unwraps the local root key into daemon memory.

```bash
abadge profile unlock
```

### `abadge profile lock`

Zeros the in-memory root key and clears daemon-held unlocked profile state.

```bash
abadge profile lock
```

### `abadge profile status`

Shows whether the daemon holds an unlocked profile.

```bash
abadge profile status
```

## Item commands

### `abadge item add`

Creates a vault item. Defaults to `server_managed` (the API encrypts at rest);
pass `--storage-mode zero_knowledge` to target a zero-knowledge profile, where
the daemon encrypts client-side. Omit `--value` to be prompted; `--value` is
rejected on a TTY, so pipe the secret via stdin instead.

```bash
echo -n 'sk-...' | abadge item add --label OPENAI_API_KEY --kind api_key
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

### `abadge item rm <item-id>`

```bash
abadge item rm <item-id>
abadge item rm <item-id> --force
```

## Agent commands

### `abadge agent add`

Registers an agent. `authMethod` is always `public_key_session`. By default the
CLI generates a local Ed25519 keypair, writes the private key at `0600`, and
uploads only the public key. Use `--bootstrap` instead to issue a one-time
`abe_...` token for a client that will enroll its own keypair, or `--public-key`
to enroll an existing public-key JWK.

```bash
abadge agent add --name "dev laptop" --kind local_cli
abadge agent add --name "ci bot" --kind remote --bootstrap
abadge agent add --name "remote svc" --kind remote --public-key ./agent.pub.jwk
```

Flags:

| Flag | Description |
|------|-------------|
| `-n, --name` | Agent name (required) |
| `-k, --kind` | Agent kind (default `local_cli`) |
| `-d, --description` | Optional description |
| `--mcp-config` | For a `local_mcp` agent, print a Claude Desktop config snippet |
| `--bootstrap` | Issue a one-time bootstrap token instead of generating a local keypair |
| `--public-key <path>` | Enroll an existing Ed25519 public-key JWK |
| `--json` | Print raw JSON |

### `abadge agent list`

Lists agents, including auth method.

```bash
abadge agent list
abadge agent list --json
```

### `abadge agent rm <agent-id>`

Revokes an agent and cascades the revocation to its sessions and grants.

```bash
abadge agent rm <agent-id>
```

## Permission commands

### `abadge permission create`

Grants one or more capabilities to an agent on an item. `--capability` is
required (there is no default) and may be repeated or comma-separated. The flag
parser accepts the canonical `read` / `use` as well as the legacy aliases
(`read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`).

> Important: this command targets an **item**, and item-target grants accept the
> legacy capability names only — canonical `read` / `use` are rejected on an
> item and accepted only when targeting a profile. Use a legacy alias here.

```bash
abadge permission create --agent-id <agent-id> --item-id <item-id> --capability mount_env
abadge permission create --agent-id <agent-id> --item-id <item-id> --capability reveal_plaintext,mount_env
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
