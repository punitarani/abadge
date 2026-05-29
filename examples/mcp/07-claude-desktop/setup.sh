#!/usr/bin/env bash
#
# Wire the abadge MCP server into Claude Desktop / Claude Code.
#
# WHY an agent (keypair), not a personal API key:
#   The MCP server reads SECRET VALUES (use_secret / mount_secret call the
#   agent-only access.* surface). Only a keypair-backed agent with an explicit
#   per-(agent, item, capability) permission can do that. An `abu_` personal
#   API key is a MANAGEMENT credential — it can create items/agents/permissions
#   but is forbidden from access.*, so it could never back this MCP server.
#
# This script registers a `local_mcp` agent and prints a ready-to-paste
# Claude Desktop server block. The Ed25519 keypair is generated locally and
# written to ~/.abadge/agents/<agent-id>.ed25519.jwk at mode 0600 — the
# private key never leaves your machine and the API only ever stores the
# public key.

set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Prerequisites: you must already be logged in as a USER and have an active
#    org + profile. Login is a management-surface action (Better Auth session),
#    completely separate from the agent identity created below.
# ---------------------------------------------------------------------------
#   abadge login                 # device-code login as a human user
#   abadge org use <id-or-slug>  # pick the org this agent lives in
#   abadge use profile default   # pick the active profile

# ---------------------------------------------------------------------------
# 1. Register a local MCP agent and print the Claude Desktop config block.
#
#    --kind local_mcp  : this agent is an MCP server on this machine.
#    --mcp-config      : print a Claude Desktop `mcpServers.abadge` block
#                        instead of raw JSON, and generate + persist the
#                        Ed25519 keypair at ~/.abadge/agents/*.ed25519.jwk
#                        (0600). The block already contains ABADGE_API_URL,
#                        ABADGE_AGENT_ID and ABADGE_PRIVATE_KEY_PATH.
#
#    (--mcp-config requires --kind local_mcp and cannot be combined with --json.)
# ---------------------------------------------------------------------------
abadge agent add \
  --name "claude-desktop" \
  --kind local_mcp \
  --mcp-config

# ---------------------------------------------------------------------------
# 2. Copy the printed block into your Claude Desktop config file:
#
#      macOS : ~/Library/Application Support/Claude/claude_desktop_config.json
#      Linux : ~/.config/Claude/claude_desktop_config.json
#      Code  : your Claude Code MCP settings (same mcpServers shape)
#
#    See claude_desktop_config.json in this directory for the exact shape.
#    Then fully restart Claude Desktop so it re-launches the stdio server.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 3. Grant the agent permission to USE specific items. Without an explicit
#    grant, every access attempt is DENIED (and audited). Capabilities:
#      use  -> env/file mount (what use_secret and mount_secret need)
#      read -> reveal / ciphertext
#    Replace the IDs with real values from `abadge agent list` / `abadge item list`.
# ---------------------------------------------------------------------------
#   abadge permission create \
#     --agent-id  <AGENT_ID_FROM_STEP_1> \
#     --item-id   <ITEM_ID> \
#     --capability use

# ---------------------------------------------------------------------------
# 4. ZERO-KNOWLEDGE items only: the MCP server decrypts ZK items through the
#    local daemon, so the daemon must be running and the profile unlocked.
#    SERVER-MANAGED items work standalone (the API decrypts), no daemon needed.
# ---------------------------------------------------------------------------
#   abadge daemon start
#   abadge profile unlock          # prompts for the profile password

echo
echo "Done. Paste the block above into claude_desktop_config.json, grant a"
echo "'use' permission (step 3), and restart Claude Desktop."
