#!/usr/bin/env bash
# CLI usage examples for abadge.
# Run `abadge --help` for the full command reference.

set -euo pipefail

# --- Authentication ---

# Interactive login (opens browser)
abadge login

# --- Credentials ---

# Store a secret
abadge secret create \
  --name prod-db-url \
  --type api_key \
  --value "postgres://..." \
  --environment prod \
  --sensitivity critical

# List all credentials
abadge secret list

# --- Running commands with secrets ---

# Inject a secret as an environment variable and run a command.
# deploy.sh can read $PROD_DB_URL from its environment.
abadge run --secret prod-db-url -- ./deploy.sh

# Mount a secret as a temporary file (created with 0600 permissions)
abadge mount --secret tls-cert --path /tmp/cert.pem

# --- Agents and permissions ---

# Grant an agent access to a credential
abadge grant create \
  --agent "<agent-id>" \
  --credential "<credential-id>" \
  --delivery-modes env_inject,file_mount

# --- Audit ---

# View recent audit log entries
abadge audit --limit 20
