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

The binary is self-contained and suitable for distribution to CI environments or developer machines without a JavaScript runtime.

## Configuration

Config is stored at `~/.abadge/config.json`:

```json
{
  "apiUrl": "http://localhost:8787",
  "token": "abg_..."
}
```

Created automatically by `abadge login`.

## Commands

### `abadge login`

Authenticate and store credentials.

```bash
abadge login --api-url http://localhost:8787
# Prompts for email and password
```

### `abadge whoami`

Show current identity.

```bash
abadge whoami
abadge whoami --json
```

### `abadge secret create`

Store a new credential.

```bash
abadge secret create \
  --name github-token \
  --type api_key \
  --value ghp_abc123 \
  --environment prod \
  --sensitivity high \
  --service github
```

### `abadge secret list`

List all credentials (metadata only).

```bash
abadge secret list
abadge secret list --json
```

### `abadge secret get <name>`

Get credential metadata. Does NOT reveal the value by default.

```bash
abadge secret get github-token
abadge secret get github-token --reveal   # Explicitly request plaintext
abadge secret get github-token --json
```

### `abadge grant create`

Grant an agent access to a credential.

```bash
abadge grant create --agent <agent-id> --credential <credential-id>
abadge grant create --agent <id> --credential <id> --delivery-modes env_inject,file_mount
```

### `abadge grant list`

List permission grants for a credential.

```bash
abadge grant list --credential <credential-id>
```

### `abadge run` (the killer command)

Run a command with a secret injected as an environment variable. The secret is never written to disk or printed to stdout.

```bash
abadge run --secret github-token -- npm run deploy
abadge run --secret github-token --env-var GITHUB_TOKEN -- npm run deploy
abadge run --secret aws-key --env-var AWS_SECRET_ACCESS_KEY -- aws s3 sync . s3://bucket
```

How it works:

1. Authenticates with the API
2. Requests the secret with `deliveryMode: reveal`
3. Spawns the child process with the secret injected as an env var
4. Forwards the child's exit code
5. Secret never touches disk or stdout

### `abadge mount`

Mount a secret as a temporary file with restricted permissions (0600).

```bash
abadge mount --secret tls-cert --path /tmp/cert.pem
abadge mount --secret service-account --path /tmp/sa.json
```

The file is deleted when you press Enter or Ctrl+C.

### `abadge audit`

View the access audit log.

```bash
abadge audit
abadge audit --limit 50
abadge audit --json
```

### `abadge approve`

Approve or deny a pending access request.

```bash
abadge approve <approval-id>
abadge approve <approval-id> --deny --reason "Not authorized for prod"
```

### `abadge connector`

Manage external vault connectors.

```bash
abadge connector add --name my-1p --type onepassword
```

## Global options

| Flag | Description |
|------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
| `--json` | Machine-readable JSON output |
