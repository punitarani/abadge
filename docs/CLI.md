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

### Verifying a release

Every release publishes, per binary, a `.tar.gz`, a `SHA256SUMS` entry, a
CycloneDX SBOM, and a keyless `cosign` signature bundle (`*.cosign.bundle`).
Verify a download against the GitHub Actions signer identity before trusting it:

```bash
cosign verify-blob \
  --bundle <artifact>.tar.gz.cosign.bundle \
  --certificate-identity 'https://github.com/punitarani/abadge/.github/workflows/release.yml@refs/heads/main' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  <artifact>.tar.gz
```

The release notes for each tag include the exact command. The SBOM
(`*.sbom.cdx.json`) is the CycloneDX dependency inventory for that build.

## Configuration

Config lives at `~/.abadge/config.json`:

```json
{
  "apiUrl": "http://localhost:8787",
  "activeOrgId": "org_...",
  "activeProfileId": "prf_...",
  "localAgents": {
    "cli": { "agentId": "agt_...", "privateKeyPath": "~/.abadge/agents/<agentId>.ed25519.jwk" },
    "mcp": { "agentId": "agt_...", "privateKeyPath": "~/.abadge/agents/<agentId>.ed25519.jwk" }
  }
}
```

No API keys are stored in config. The operator session token is held in
daemon memory only. Agent private keys live in `0600` files under
`~/.abadge/agents/`. The daemon socket is `~/.abadge/vaultd.sock`.

## Command groups

| Group | Purpose |
|-------|---------|
| `auth` (`login`, `logout`) | Operator session |
| `context` (`use`) | Switch active org or profile |
| `org`, `profile` | Manage orgs, profiles, and the profile vault key |
| `item` | Create, read, update, delete credential items |
| `agent` | Register, list, revoke agents |
| `permission` | Create, list, revoke grants |
| `run`, `mount` | Use a secret — inject into a subprocess or mount a temp file |
| `import`, `export` | Bulk `.env` import/export |
| `audit` | Read recent audit events |
| `daemon` | Manage the local daemon lifecycle |

### Operator session

#### `abadge login`

Device-code login. Opens the approval URL in the browser, stores `apiUrl`
in config, holds the operator bearer token in daemon memory. Does NOT
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
secret from stdin instead. Supported kinds: `login`, `api_key`, `token`,
`json`, `certificate`, `ssh_key`, `opaque`.

### Agents

```bash
# Register a new agent. Default authMethod is Ed25519 keypair session.
# Generates the keypair on-device, stores the private key in
# `~/.abadge/agents/`, and uploads the public key.
abadge agent add --name "ci-deploy" --kind remote
abadge agent add --name "ci-deploy" --kind remote --bootstrap   # issue a one-time bootstrap token instead
abadge agent add --name "ci-deploy" --kind remote --public-key ./key.jwk  # pre-existing public key

# Register a local_mcp agent and print a Claude Desktop config snippet
abadge agent add --name "claude-desktop" --kind local_mcp --mcp-config

abadge agent list
abadge agent rm <id>       # revoke the agent and invalidate all sessions

# Re-print the Claude Desktop config snippet for the registered local_mcp agent
abadge agent mcp-config <id>
```

Agents authenticate only with Ed25519 keypair sessions. To replace an
agent's keypair, revoke it and register a new one (or re-issue a bootstrap
token and re-enroll).

`--mcp-config` (on `agent add`) is only valid with `--kind local_mcp` and
cannot be combined with `--json`. `abadge agent mcp-config <id>` reprints the
snippet for the local_mcp agent already registered on this machine; `<id>`
must match the agent in `~/.abadge/config.json`.

### Permissions (grants)

```bash
# Grant a single capability to an agent on an item
abadge permission create --agent-id <id> --item-id <id> --capability mount_env

# Grant several capabilities atomically (repeat the flag or comma-separate)
abadge permission create --agent-id <id> --item-id <id> \
  --capability mount_env,mount_file

# With expiry (applies to every capability in the batch)
abadge permission create --agent-id <id> --item-id <id> \
  --capability reveal_plaintext --expires-at 2026-12-31T00:00:00Z

abadge permission list [--agent-id <id>] [--item-id <id>]
abadge permission revoke <permission-id>
```

`permission create` always targets a single item (`--item-id`), and
item-target grants accept only the legacy capability names —
`read_ciphertext`, `reveal_plaintext` (mapped to canonical `read`) and
`mount_env`, `mount_file` (mapped to canonical `use`). Capability legality
is still bounded by the agent's locality and the item's storage mode (for
example, remote agents cannot mount, and only server-managed items can be
revealed over the API).

To grant the canonical `read` / `use` capabilities on an entire profile,
use the dashboard (it requires a blast-radius confirmation) or the API/SDK
`permissions.create` with a `profileId` target. The CLI does not create
profile-target grants.

### Runtime — use a secret

#### `abadge run`

Resolves secrets and injects them into a subprocess via the daemon. Exits
with the child process exit code.

```bash
# Single item — default env var ABADGE_SECRET
abadge run --item <id> -- npm run deploy

# Pull a specific field; name the env var explicitly
abadge run --item <id> --field password --env-var DB_PASSWORD -- psql "$DB_HOST"

# Expand every field into env vars (field name = var name)
abadge run --item my-service-env --expand-env -- ./server

# Bulk mode: every item in the active profile that the agent has `use` on
abadge run --all -- npm start

# Bulk mode against a specific profile
abadge run --all --profile prf_dev -- ./worker
```

`--field` and `--env-var` are single-valued: `abadge run` injects one secret
per invocation. To inject more than one field from the same item, use
`--expand-env`, which maps every field to a same-named env var.

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
abadge audit --limit 50                 # cap the number of entries returned
abadge audit --cursor <cursor>          # fetch the next page (cursor printed after a capped page)
```

`--limit <count>` caps the number of returned entries; `--cursor <cursor>`
fetches the next page using the cursor printed at the end of a previous page.

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
| `--token-stdin` | Read a bearer session token from stdin for this command |

`--json` is **not** a global flag. It is a per-subcommand option on the
commands that support machine-readable output (e.g. `abadge audit --json`,
`abadge agent add --json`).

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
