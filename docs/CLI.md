# CLI Reference

The `abadge` CLI is the local operator interface for the control plane and
the vault daemon.

## Installation

```bash
# Public installer (CLI + MCP server)
curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash

# CLI only
ABADGE_INSTALL_PACKAGE=cli \
  curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash

# Development entrypoint
bun run cli -- --help
```

See [`docs/release/cli.md`](./release/cli.md) and
[`docs/release/mcp.md`](./release/mcp.md) for the per-package release flow.

## Configuration

Config lives at `~/.abadge/config.json`:

```json
{
  "apiUrl": "http://localhost:8787",
  "activeOrgId": "org_...",
  "activeProfileId": "prf_...",
  "localAgents": {
    "cli": { "agentId": "agt_...", "privateKeyPath": "~/.abadge/agents/cli.ed25519.jwk" },
    "mcp": { "agentId": "agt_...", "privateKeyPath": "~/.abadge/agents/mcp.ed25519.jwk" }
  }
}
```

No API keys are stored in config. The Better Auth session token is held in
daemon memory only. Agent private keys live in `0600` files under
`~/.abadge/agents/`. The daemon socket is `~/.abadge/vaultd.sock`.

## Command groups

| Group | Purpose |
|-------|---------|
| `auth` (`login`, `logout`) | Operator session |
| `context` (`use`) | Switch active org or profile |
| `org`, `profile` | Manage orgs, profiles, and the profile vault key |
| `item` | Create, read, update, delete credential items |
| `agent` | Register, list, rotate, revoke agents |
| `permission` | Create, list, revoke grants |
| `run`, `mount` | Use a secret — inject into a subprocess or mount a temp file |
| `import`, `export` | Bulk `.env` import/export |
| `audit` | Read recent audit events |
| `daemon` | Manage the local daemon lifecycle |

### Operator session

#### `abadge login`

Device-code login. Opens the approval URL in the browser, stores `apiUrl`
in config, holds the Better Auth bearer token in daemon memory. Does NOT
auto-register an agent.

```bash
abadge login
abadge login --api-url http://localhost:8787
```

#### `abadge logout`

Logs out the current session, audits the event, clears local config.

### Switching context

#### `abadge use org <id-or-slug>`

Set the active organization for subsequent commands.

#### `abadge use profile <name-or-id>`

Set the active profile in the active organization.

### Organizations

| Command | Description |
|---------|-------------|
| `abadge org add --name <name>` | Create an org. Server auto-creates a default `server_managed` profile. |
| `abadge org list` | List orgs the current user belongs to. |
| `abadge org members` | List members of the active organization. |

### Profiles

| Command | Description |
|---------|-------------|
| `abadge profile add --name <name> [--storage-mode <mode>]` | Create a profile (default `server_managed`). |
| `abadge profile list` | List profiles in the active org. |
| `abadge profile unlock` | Unlock the active profile in daemon memory (ZK only). |
| `abadge profile lock` | Clear the unlocked profile state from the daemon. |
| `abadge profile status` | Show whether the daemon holds an unlocked profile. |
| `abadge profile change-password` | Re-wrap the profile root key with a new password. |

### Items

```bash
# Create
abadge item add --label "OpenAI" --kind api_key --storage-mode server_managed
abadge item add --label "Deploy SSH key" --kind ssh_key --storage-mode zero_knowledge

# Read
abadge item list
abadge item get <id> [--reveal]

# Update / delete
abadge item update <id>
abadge item rm <id> [--force]
```

`--value` is rejected on a TTY to prevent shell-history leaks; pipe the
secret from stdin instead. Supported kinds: `opaque`, `api_key`, `login`,
`token`, `ssh_key`, `certificate`, `json`.

### Agents

```bash
# Register a new agent. Default authMethod is Ed25519 keypair session.
# Generates the keypair on-device, stores the private key in
# `~/.abadge/agents/`, and uploads the public key.
abadge agent add --name "ci-deploy" --kind remote
abadge agent add --name "ci-deploy" --kind remote --bootstrap   # issue a one-time bootstrap token instead
abadge agent add --name "ci-deploy" --kind remote --public-key ./key.jwk  # pre-existing public key

abadge agent list
abadge agent rotate <id>   # rotates the legacy API key on legacy agents
abadge agent rm <id>       # revoke the agent and invalidate all sessions
```

Legacy API key auth is not creatable via the CLI; create one through the
API if you need it for migration.

### Permissions (grants)

```bash
# Grant a single capability to an agent on an item
abadge permission create --agent-id <id> --item-id <id> --capability use

# Grant both capabilities atomically (repeat the flag or comma-separate)
abadge permission create --agent-id <id> --item-id <id> --capability read,use

# With expiry (applies to every capability in the batch)
abadge permission create --agent-id <id> --item-id <id> \
  --capability use --expires-at 2026-12-31T00:00:00Z

abadge permission list [--agent-id <id>] [--item-id <id>]
abadge permission revoke <permission-id>
```

`--capability` accepts the canonical `read` / `use` and the legacy aliases
(`read_ciphertext`, `reveal_plaintext`, `mount_env`, `mount_file`). The
dashboard is the recommended surface for profile-target grants — they
require the blast-radius confirmation.

### Runtime — use a secret

#### `abadge run`

Resolves secrets and injects them into a subprocess via the daemon. Exits
with the child process exit code.

```bash
# Single item — default env var ABADGE_SECRET
abadge run --item <id-or-label> -- npm run deploy

# Pull a specific field; name the env var explicitly
abadge run --item <id> --field password --env-var DB_PASSWORD -- psql "$DB_HOST"

# Stack triples to inject multiple fields from one item
abadge run --item prod-db --field username --env-var DB_USER \
                          --field password --env-var DB_PASSWORD -- ./migrate.sh

# Expand every field into env vars (field name = var name)
abadge run --item my-service-env --expand-env -- ./server

# Bulk mode: every item in the active profile that the agent has `use` on
abadge run --all -- npm start

# Bulk mode against a specific profile
abadge run --all --profile prf_dev -- ./worker
```

Bulk-mode rules: only items with exactly one string field participate;
multi-field items are silently skipped. Two items normalizing to the same
env var name, or labels normalizing to reserved keys (`PATH`,
`LD_PRELOAD`, `NODE_OPTIONS`, ...) are hard-rejected. Capped at 256 items
per run. Each included item produces its own audit row tagged
`meta.viaBulk = true`.

#### `abadge mount`

Materializes a secret as a temp file (`0600`).

```bash
abadge mount --item <id>
abadge mount --item <id> --field private_key
abadge mount --item <id> --path /tmp/my-secret.txt
```

### Bulk import / export

```bash
abadge import .env                 # creates server-managed items per var
abadge import secrets.env --kind api_key --overwrite
abadge import .env --dry-run

abadge export                      # default .env format
abadge export --format json
abadge export --format env > secrets.env
```

`import --overwrite` refuses to touch zero-knowledge items; delete and
re-import, or use `abadge item update`. The summary reports
`created`/`updated`/`skipped`/`refused`/`failed`; non-zero exit only when
`failed > 0`.

### Audit

```bash
abadge audit
abadge audit --json
```

### Daemon

```bash
abadge daemon start
abadge daemon status
abadge daemon stop
```

## Global options

| Flag | Description |
|------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
| `--json` | Print machine-readable output on commands that support it |
| `--token-stdin` | Read a bearer session token from stdin for this command |

## Deprecated verbs

For backwards compatibility, the following verbs print a deprecation
notice and re-dispatch to the canonical verb:

| Deprecated | Canonical |
|------------|-----------|
| `abadge <noun> create` | `abadge <noun> add` (item, agent, profile, org) |
| `abadge <noun> delete` | `abadge <noun> rm` (item, profile, org) |
| `abadge agent register` | `abadge agent add` |
| `abadge agent revoke` | `abadge agent rm` |

The deprecated verbs are hidden from `--help`.
