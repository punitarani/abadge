#!/usr/bin/env bash
#
# 04-quickstart.sh — end-to-end abadge CLI walkthrough
#
# What this shows:
#   The full developer loop with the `abadge` CLI — log in, pick an org and
#   profile, store a secret, register a local agent, grant it a capability,
#   then USE the secret (inject it into a child process and mount it as a
#   file) and read the audit trail.
#
# Mental model (why each step exists):
#   abadge is a credential firewall. A secret lives in a *profile*. An *agent*
#   is the only thing that can ever read or use a secret value, and only when
#   an explicit (agent, item, capability) *permission* grants it. Every access
#   attempt — allowed or denied — is logged. The CLI you log into with
#   `abadge login` is the MANAGEMENT surface (it creates items/agents/grants);
#   the local_cli AGENT it registers is the ACCESS surface (it actually pulls
#   the secret value). `abadge run`/`abadge mount` act as that agent for you.
#
# Security properties this script relies on:
#   - `--value` is REJECTED on a TTY so secrets never land in shell history.
#     We always feed the secret via a stdin pipe instead.
#   - `abadge run` injects the secret straight into the child process's
#     environment. It is never written to disk and never echoed to your shell.
#   - `abadge mount` writes a 0600 temp file that auto-cleans; the path is the
#     only thing you handle, not the secret body.
#
# Prerequisites: a reachable abadge API and the `abadge` binary on PATH.
# Run:  bash examples/cli/04-quickstart.sh   (see examples/cli/README.md)

set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Install (commented — do this once, not on every run)
# ---------------------------------------------------------------------------
# CLI-only install:
#   ABADGE_INSTALL_PACKAGE=cli \
#     curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
# Or, inside this repo for development, replace every `abadge` below with:
#   bun run cli --

# `jq` is required: we ask the CLI for JSON (`--json`) and parse out the IDs.
command -v jq >/dev/null 2>&1 || { echo "error: jq is required (brew install jq)"; exit 1; }

# Optional override of the API URL. The CLI persists this to ~/.abadge/config.json.
API_URL="${ABADGE_API_URL:-}"

# A label we reuse so re-running the script is easy to follow.
ITEM_LABEL="${ITEM_LABEL:-demo-api-key}"
AGENT_NAME="${AGENT_NAME:-laptop-cli}"

# ---------------------------------------------------------------------------
# 1. Log in (interactive device-code flow)
# ---------------------------------------------------------------------------
# This authenticates YOU as a user (the management surface). It does NOT
# register an agent — registering the agent is an explicit step below.
if [[ -n "$API_URL" ]]; then
  abadge login --api-url "$API_URL"
else
  abadge login
fi

# ---------------------------------------------------------------------------
# 2. Pick an organization
# ---------------------------------------------------------------------------
# Agents, items, and permissions are all org-scoped. A freshly created org (or
# a personal account) already exists with a usable default profile, so you may
# already have one. List what you can see, and create one only if needed.
abadge org list

# Uncomment to create a fresh org and switch to it:
#   abadge org add --name "Demo Org"
#   abadge org use "demo-org"           # by slug, or pass the org id

# Ensure an active org is selected (no-op if you only have one / already chose):
#   abadge use org <id-or-slug>

# ---------------------------------------------------------------------------
# 3. Pick (or create) a profile
# ---------------------------------------------------------------------------
# A profile is the encryption boundary that holds items. Every org is seeded
# with a default `server_managed` profile, so listing is usually enough.
abadge profile list

# Create a dedicated server_managed profile for this demo and make it active.
# server_managed means the API encrypts at rest with AES-256-GCM — no vault
# password needed (unlike a zero_knowledge profile, which is client-encrypted).
abadge profile add --name "quickstart" --storage-mode server_managed || true
abadge profile use "quickstart"

# ---------------------------------------------------------------------------
# 4. Store a secret — PIPE it from stdin, never via --value
# ---------------------------------------------------------------------------
# `--value` is rejected on a TTY precisely so a real credential can't leak into
# your shell history. We pipe the value in and ask for JSON so we can capture
# the new item id. `echo -n` avoids a trailing newline in the stored secret.
ITEM_JSON="$(echo -n 'super-secret' \
  | abadge item add --label "$ITEM_LABEL" --kind api_key --json)"

ITEM_ID="$(printf '%s' "$ITEM_JSON" | jq -r '.id')"
echo "Stored item: $ITEM_ID (label=$ITEM_LABEL, kind=api_key)"

# ---------------------------------------------------------------------------
# 5. Register a local_cli agent
# ---------------------------------------------------------------------------
# The agent is the ACCESS identity. Only an agent with an explicit permission
# can read/use a secret value — your user login alone cannot. A local_cli agent
# gets an Ed25519 keypair stored locally so `abadge run`/`mount` can act as it.
AGENT_JSON="$(abadge agent add --name "$AGENT_NAME" --kind local_cli --json)"
AGENT_ID="$(printf '%s' "$AGENT_JSON" | jq -r '.agent.id')"
echo "Registered agent: $AGENT_ID (name=$AGENT_NAME, kind=local_cli)"

# ---------------------------------------------------------------------------
# 6. Grant the agent a capability on the item
# ---------------------------------------------------------------------------
# No access without an explicit (agent, item, capability) grant. CLI grants
# target a single item, so they use the legacy capability names: `mount_env`
# (and `mount_file`) map to canonical `use` for env/file injection, and
# `reveal_plaintext`/`read_ciphertext` map to canonical `read`. Grant a read
# alias instead (or as well, by repeating --capability) for the raw value.
abadge permission create \
  --agent-id "$AGENT_ID" \
  --item-id "$ITEM_ID" \
  --capability mount_env

# ---------------------------------------------------------------------------
# 7. USE the secret — inject it into a child process
# ---------------------------------------------------------------------------
# `abadge run` resolves the secret as the agent, injects it into the child's
# environment under the name you pick, then runs your command. The value never
# touches disk or your shell history. Here we just print the env var to prove
# it arrived; in real use this would be `-- ./your-tool.sh` or any command.
abadge run --item "$ITEM_ID" --env-var DEMO_KEY -- printenv DEMO_KEY

# ---------------------------------------------------------------------------
# 8. USE the secret — mount it as a 0600 file
# ---------------------------------------------------------------------------
# For tools that read a credential from a file path rather than an env var.
# `abadge mount` writes a temp file with 0600 permissions and prints its path;
# the file auto-cleans and the secret body never appears in your terminal.
abadge mount --item "$ITEM_ID"

# ---------------------------------------------------------------------------
# 9. Inspect the audit trail
# ---------------------------------------------------------------------------
# Every access attempt above — allowed or denied — is recorded immutably.
# This is the firewall's accountability layer.
abadge audit --limit 5

echo "Quickstart complete."
