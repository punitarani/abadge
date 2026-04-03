# CLI Specification

> Command reference for the `abadge` CLI.
> The CLI is the primary operator interface for managing vaults, items, agents, and permissions.

## Overview

The CLI is a compiled Bun binary that communicates with two backends:

| Backend | Protocol | Purpose |
|---------|----------|---------|
| **API** (control plane) | HTTPS (via SDK) | CRUD operations, agent management, permissions, audit |
| **Daemon** (local vault) | JSON-RPC over Unix socket | Vault unlock/lock, client-side encryption/decryption, subprocess injection |

The daemon is required for zero-knowledge operations (encrypt, decrypt, run, mount). Server-managed operations work without it.

---

## Configuration

### Config File

**Path:** `~/.abadge/config.json`
**Permissions:** `0600` (owner read/write only)

```json
{
  "apiUrl": "https://api.abadge.dev",
  "token": "session_token_from_login"
}
```

### Daemon Files

| File | Purpose |
|------|---------|
| `~/.abadge/vaultd.sock` | Unix domain socket for daemon RPC |
| `~/.abadge/vaultd.pid` | Daemon process ID |

---

## Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--help` | `-h` | Show help for any command |
| `--version` | `-v` | Print CLI version |
| `--json` | | Output as JSON (where supported) |

---

## Commands

### Authentication

#### `abadge login`

Authenticate with the abadge control plane. Stores session token locally.

```
abadge login [options]

Options:
  --api-url <URL>       API endpoint (default: https://api.abadge.dev)
  --email <EMAIL>       Email address (interactive prompt if omitted)
  --password <PASSWORD> Password (masked interactive prompt if omitted)
```

**Behavior:**
1. Prompt for email and password if not provided as flags.
2. POST to `{apiUrl}/api/auth/sign-in/email`.
3. On success, write `{ apiUrl, token }` to `~/.abadge/config.json` with mode `0600`.
4. Print success message.

**Exit codes:**
| Code | Meaning |
|------|---------|
| 0 | Login successful |
| 1 | Authentication failed (bad credentials, network error) |

---

### Daemon Management

#### `abadge daemon start`

Start the local vault daemon.

```
abadge daemon start
```

**Behavior:**
1. Read `apiUrl` and `token` from config.
2. Spawn daemon as detached child process.
3. Poll socket for readiness (up to 2 seconds).
4. Print confirmation or error.

**Requires:** Valid config (`~/.abadge/config.json`).

#### `abadge daemon stop`

Stop the running daemon.

```
abadge daemon stop
```

**Behavior:**
1. Read PID from `~/.abadge/vaultd.pid`.
2. Send SIGTERM.
3. Clean up PID file.

#### `abadge daemon status`

Check daemon status.

```
abadge daemon status
```

**Output:** JSON with daemon state (running/stopped, vault locked/unlocked).

---

### Vault Management

All vault commands require a running daemon.

#### `abadge vault unlock`

Unlock the vault with the master password. The root key is held in daemon memory.

```
abadge vault unlock
```

**Behavior:**
1. Prompt for master password (masked input).
2. Send `vault.unlock` RPC to daemon.
3. Daemon derives KEK from password, unwraps root key, holds in memory.
4. Print unlock confirmation with key version.

**Auto-lock:** Daemon auto-locks after 15 minutes of inactivity.

#### `abadge vault lock`

Lock the vault immediately. Zeros the root key from daemon memory.

```
abadge vault lock
```

#### `abadge vault status`

Print vault lock status.

```
abadge vault status
```

**Output:** `unlocked` (with key version) or `locked`.

#### `abadge vault change-password`

Change the master password.

```
abadge vault change-password
```

**Behavior:**
1. Prompt for current password (masked).
2. Prompt for new password (masked).
3. Prompt for new password confirmation.
4. Validate confirmation matches.
5. Send `vault.changePassword` RPC to daemon.
6. Daemon re-derives KEK, re-wraps root key, pushes to API.

**Requires:** Vault unlocked.

---

### Item Management

#### `abadge item create`

Create a new secret item. Interactive flow.

```
abadge item create
```

**Interactive prompts:**
1. **Label** — human-readable name (required).
2. **Kind** — select from: `login`, `api_key`, `token`, `json`, `certificate`, `ssh_key`, `opaque`.
3. **Value** — the secret content (masked input).

**Behavior:**
- Default storage mode: `zero_knowledge` (if daemon is running and vault is unlocked).
- CLI encrypts payload locally via daemon, then sends encrypted blob to API.
- If daemon is not available, falls back to `server_managed` with a warning.

**Output:** Item ID.

#### `abadge item list`

List all items (metadata only).

```
abadge item list [--json]
```

**Table output:**

```
ID                                   Storage          Version  Created
a1b2c3d4-...                         zero_knowledge   1        2026-04-01T...
e5f6g7h8-...                         server_managed   3        2026-03-28T...
```

**JSON output:** `{ items: ItemSummary[] }`

#### `abadge item get <id>`

Retrieve a single item. Attempts local decryption for ZK items.

```
abadge item get <id> [--json]
```

**Behavior:**
- For ZK items: fetches encrypted blob, decrypts via daemon, displays payload.
- For server-managed items: displays metadata only (use `access.reveal` through an agent for plaintext).

**Requires:** Daemon running and vault unlocked (for ZK decryption).

#### `abadge item delete <id>`

Soft-delete an item.

```
abadge item delete <id> [-f|--force]
```

**Behavior:**
1. Without `--force`: prompt for confirmation (`Are you sure? [y/N]`).
2. With `--force`: skip confirmation.
3. Soft-deletes the item (sets `deletedAt`).

---

### Agent Management

#### `abadge agent register`

Register a new agent and display the one-time API key.

```
abadge agent register -n <name> [-k <kind>] [-d <description>] [--json]

Options:
  -n, --name <NAME>         Agent name (required)
  -k, --kind <KIND>         Agent kind (default: remote_agent)
                             Values: device, local_cli, local_mcp, remote_agent
  -d, --description <DESC>  Description (stored in metadata)
  --json                    Output as JSON
```

**Output (terminal):**

```
Agent registered successfully.

  ID:    a1b2c3d4-...
  Name:  my-ci-agent
  Kind:  remote_agent

  API Key: abg_a1b2c3d4e5f6...

  WARNING: This key will not be shown again. Store it securely.
```

**Output (JSON):** `{ agent: Agent, apiKey: string }`

#### `abadge agent list`

List all registered agents.

```
abadge agent list [--json]
```

**Table output:**

```
ID                  Name          Kind           Locality  Enabled  Created
a1b2c3d4-...        my-ci-agent   remote_agent   remote    true     2026-04-01T...
e5f6g7h8-...        local-dev     local_cli      local     true     2026-03-28T...
```

#### `abadge agent revoke <id>`

Revoke an agent. Immediately invalidates its API key.

```
abadge agent revoke <agentId>
```

---

### Permission Management

#### `abadge permission create`

Grant a capability to an agent for a specific item.

```
abadge permission create --agent-id <ID> --item-id <ID> [--capability <CAP>] [--json]

Options:
  --agent-id <ID>       Agent to grant access to (required)
  --item-id <ID>        Item to grant access for (required)
  --capability <CAP>    Capability to grant (default: mount_env)
                         Values: read_ciphertext, reveal_plaintext, mount_env, mount_file, use_without_reveal
  --json                Output as JSON
```

**Design decision:** Default capability is `mount_env`, not `reveal_plaintext`. This follows the principle of least privilege — env injection is the safest delivery mode for most use cases.

#### `abadge permission list`

List all permissions.

```
abadge permission list [--json]
```

**Table output:**

```
ID                  Agent               Item                Capability        Created
a1b2c3d4-...        e5f6g7h8-...        i9j0k1l2-...        mount_env         2026-04-01T...
```

#### `abadge permission revoke <id>`

Revoke a specific permission.

```
abadge permission revoke <permissionId>
```

---

### Secret Execution

#### `abadge run`

Execute a command with a secret injected as an environment variable.

```
abadge run --item <id> -- <command> [args...]

Options:
  --item <ID>    Item ID to inject (required)
```

**Behavior:**
1. Resolve secret value (daemon decrypt for ZK, API reveal for server-managed).
2. Inject into subprocess as `ABADGE_SECRET` environment variable.
3. Subprocess inherits all other environment variables and stdio.
4. CLI exits with the subprocess exit code.

**Security properties:**
- Secret never appears in command arguments (no `ps` leak).
- Secret is not written to disk.
- Secret is not logged.
- Subprocess environment is isolated from parent.

**Example:**

```bash
abadge run --item a1b2c3d4 -- curl -H "Authorization: Bearer $ABADGE_SECRET" https://api.example.com
```

#### `abadge mount`

Mount a secret as a temporary file.

```
abadge mount --item <id>

Options:
  --item <ID>    Item ID to mount (required)
```

**Behavior:**
1. Resolve secret value.
2. Write to temporary file with permissions `0600`.
3. Print the file path to stdout.

**Output:** `/tmp/abadge-xxxxx/secret`

**Security properties:**
- File is readable only by the current user.
- File path can be passed to tools that expect file-based credentials (e.g., `--key-file`).

---

### Audit

#### `abadge audit`

View the audit log.

```
abadge audit [--json]
```

**Table output:**

```
ID    Agent               Item                Event              Outcome   Mode       Time
1     e5f6g7h8-...        i9j0k1l2-...        access.mount_env   allowed   mount_env  2026-04-01T...
2     e5f6g7h8-...        i9j0k1l2-...        access.reveal      denied    reveal     2026-04-01T...
```

**JSON output:** `{ entries: AuditEntry[], nextCursor: string | null }`

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (API error, validation failure, network error) |
| 2 | Usage error (bad arguments, missing required flags) |
| N | For `abadge run`: the exit code of the subprocess |

---

## Daemon RPC Methods

These are internal JSON-RPC 2.0 methods called by the CLI over the Unix socket. They are not part of the public API.

| Method | Params | Result |
|--------|--------|--------|
| `vault.unlock` | `{ masterPassword }` | `{ ok, keyVersion }` |
| `vault.lock` | — | `{ ok }` |
| `vault.status` | — | `{ locked, keyVersion }` |
| `vault.changePassword` | `{ oldPassword, newPassword }` | `{ ok }` |
| `item.encrypt` | `{ payload }` | `{ encryptedItemKey, ciphertext }` |
| `item.decrypt` | `{ encryptedItemKey, ciphertext }` | `{ payload }` |
| `item.rekey` | `{ items, oldRootKey }` | `[{ id, newEncryptedItemKey }]` |
| `exec.env` | `{ secretValue, envVar, command, args }` | `{ exitCode, signal? }` |
| `exec.mount` | `{ secretValue, path?, mode? }` | `{ path }` |
| `exec.cleanup` | `{ path }` | `{ ok }` |

**Daemon error codes (JSON-RPC):**

| Code | Meaning |
|------|---------|
| `-32000` | Vault is locked |
| `-32001` | Vault already unlocked |
| `-32002` | Wrong password |
| `-32003` | Vault not found (not bootstrapped) |

---

## Design Decisions

### Why a local daemon?

The daemon enables zero-knowledge encryption without requiring the user to re-enter their password for every operation. The root key lives in process memory with auto-lock, never on disk. This mirrors the 1Password agent model — unlock once, use until timeout.

### Why `mount_env` as default capability?

Environment variable injection is the safest common delivery mode:
- No disk persistence (unlike `mount_file`)
- No plaintext in CLI output (unlike `reveal_plaintext`)
- Works with any subprocess that reads env vars
- Secret is isolated to the subprocess environment

### Why interactive prompts by default?

Secrets should never appear in shell history. Interactive masked prompts prevent `abadge item create --value "my-secret"` from being recorded in `~/.zsh_history`. Flags are available for scripting (`--email`, `--password`) but the default path is interactive.
