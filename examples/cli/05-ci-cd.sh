#!/usr/bin/env bash
# abadge CLI example 05 — non-interactive CI/CD bulk secret injection.
# See ./README.md for prerequisites, setup, and security notes.
#
# Scenario: a CI job builds/deploys without a browser and without writing any
# secret to disk. It bulk-injects every single-field secret in a profile into a
# single deploy command, then (optionally) prints an audit summary.
set -euo pipefail

# ---------------------------------------------------------------------------
# Auth model (the whole point of this example)
# ---------------------------------------------------------------------------
# `abadge run` READS/USES secret values — that is the agent `access.*` surface,
# reachable only by an AGENT session (`abs_`, minted from an Ed25519 keypair).
# So the CLI authenticates `run` with the AGENT KEYPAIR, NOT with a session
# token: it reads ABADGE_AGENT_ID + ABADGE_PRIVATE_KEY (an inline Ed25519 JWK),
# performs the challenge/exchange itself, and mints a FRESH ~15-minute `abs_`
# session on every invocation.
#
# The durable CI secret is therefore the agent's PRIVATE KEY, not a token. There
# is nothing that "goes stale" between runs and nothing to rotate on a schedule:
# each job mints its own short-lived session from the long-lived keypair. (Do
# NOT store an `abs_` token as a CI secret — it would expire in 15 minutes.)
#
# Generate the keypair once with `abadge agent add --kind local_cli --json`
# (it writes ~/.abadge/agents/<id>.ed25519.jwk, 0600) or with the SDK
# (`generateEd25519KeyPair()` + agent enrollment), then store the JWK string as
# the ABADGE_PRIVATE_KEY CI secret and grant the agent `use` on the items.

# ---------------------------------------------------------------------------
# Required environment (injected by the CI runner from its secret store)
# ---------------------------------------------------------------------------
: "${ABADGE_API_URL:?set ABADGE_API_URL, e.g. https://api.abadge.dev}"
: "${ABADGE_AGENT_ID:?set ABADGE_AGENT_ID to the agent's id}"
: "${ABADGE_PRIVATE_KEY:?set ABADGE_PRIVATE_KEY to the agent's Ed25519 JWK string (a CI secret)}"
: "${ABADGE_PROFILE:?set ABADGE_PROFILE to the profile id holding the secrets}"

# The CLI's agent-client resolver reads these straight from the environment.
export ABADGE_API_URL ABADGE_AGENT_ID ABADGE_PRIVATE_KEY

# ---------------------------------------------------------------------------
# Bulk-inject every eligible secret into the deploy command.
# ---------------------------------------------------------------------------
# `run --all` rules (bulk mode):
#   - injects every single-STRING-field item the agent can "use" in the target
#     profile, as environment variables on the child process.
#   - each item's label is normalized into an ENV_VAR name.
#   - multi-field items are SKIPPED (ambiguous — no single value to inject).
#   - reserved env names (PATH, LD_PRELOAD, NODE_OPTIONS) are REJECTED.
#   - hard cap of 256 items.
#   - NOTHING is written to disk: values live only in the child's environment
#     and vanish when it exits. (Contrast `abadge mount`, which writes a 0600
#     temp file.)
# `--profile` takes the profile id so there is no dependency on local config
# state. Every injection — allowed or denied — is recorded in the audit log.
abadge run --all --profile "$ABADGE_PROFILE" -- ./deploy.sh

# ---------------------------------------------------------------------------
# Optional audit summary: confirm what the agent accessed during this run.
# ---------------------------------------------------------------------------
# `abadge audit` is a MANAGEMENT command (it runs as the user/management client),
# so it takes a personal API key (`abu_`) — a different, management-only
# credential from the agent keypair above. Skip the summary if none is provided.
if [[ -n "${ABADGE_API_KEY:-}" ]]; then
  printf '%s' "$ABADGE_API_KEY" \
    | abadge audit --json --limit 20 --token-stdin \
    | jq -r '.entries[] | "\(.occurredAt)  \(.eventType)  \(.result)  \(.itemId // "-")"'
fi
