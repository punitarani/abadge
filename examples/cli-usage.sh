#!/usr/bin/env bash
# CLI usage examples for abadge.
# Run `abadge --help` for the full command reference.

set -euo pipefail

# Interactive login (opens browser)
abadge login

# Unlock the local vault before decrypting zero-knowledge items
abadge vault unlock

# Create an item (interactive: prompts for label, kind, and value)
abadge item create

# List registered items
abadge item list

# Register an agent and save the one-time API key
abadge agent register --name "deploy bot" --kind remote_agent

# Create a permission for one agent + item pair
abadge permission create \
  --agent-id <agent-id> \
  --item-id <item-id> \
  --capability reveal_plaintext

# Run a local command with an item mounted into the environment
abadge run --item <item-id> -- ./deploy.sh

# Mount an item as a temporary file
abadge mount --item <item-id>

# View recent audit log entries
abadge audit
