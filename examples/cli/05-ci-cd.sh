#!/usr/bin/env bash
# abadge CLI example 05 — non-interactive CI/CD bulk secret injection.
# See ./README.md (written by example 04) for prerequisites, setup, and security notes.
#
# Scenario: a CI job builds/deploys without a browser and without writing any
# secret to disk. It bulk-injects every single-field secret in a profile into a
# single deploy command, then prints an audit summary.
set -euo pipefail

# ---------------------------------------------------------------------------
# Trust tier (the whole point of this example)
# ---------------------------------------------------------------------------
# `abadge run` READS/USES secret values. That is the agent `access.*` surface.
# Only an AGENT session token (prefix `abs_`, minted from an Ed25519 keypair)
# can reach it. Management credentials — a Better Auth session or a personal
# API key (`abu_`) — are management-only and throw UNAUTHORIZED on access.*.
#
# So ABADGE_SESSION_TOKEN below MUST be an `abs_` agent session token. An `abs_`
# session is literally a session token; there is no contradiction. Build a CI
# example on `abu_` and it breaks at runtime.
#
# TTL caveat: `abs_` sessions live ~15 minutes. A statically-stored secret named
# ABADGE_SESSION_TOKEN goes stale by design. In real CI you mint it fresh at job
# start from the agent's keypair, either with @abadge/sdk
# (`new AbadgeAgentClient({...}).connect()`) or over raw HTTP via
# POST /v1/agents/{id}/sessions/challenge + .../exchange. The CLI has no
# session-exchange subcommand — do not invent one. This example honors the task
# literally (token in a secret, piped per command) and leaves minting to the
# step that produces ABADGE_SESSION_TOKEN.

# ---------------------------------------------------------------------------
# Required environment (injected by the CI runner from its secret store)
# ---------------------------------------------------------------------------
: "${ABADGE_SESSION_TOKEN:?set ABADGE_SESSION_TOKEN to an abs_ agent session token}"
: "${ABADGE_ORG:?set ABADGE_ORG to the org id or slug}"
: "${ABADGE_PROFILE:?set ABADGE_PROFILE to the profile name or id}"

# ---------------------------------------------------------------------------
# Select org + profile.
# ---------------------------------------------------------------------------
# `abadge use ...` only writes ~/.abadge/config.json (local state); it needs no
# bearer token. Every command that actually talks to the API gets its OWN token
# piped in: --token-stdin consumes stdin once, per invocation — a single pipe
# does NOT persist across commands.
abadge use org "$ABADGE_ORG"
abadge use profile "$ABADGE_PROFILE"

# ---------------------------------------------------------------------------
# Bulk-inject every eligible secret into the deploy command.
# ---------------------------------------------------------------------------
# `run --all` rules (bulk mode):
#   - injects every single-STRING-field item the agent can "use" in the active
#     profile, as environment variables on the child process.
#   - each item's label is normalized into an ENV_VAR name.
#   - multi-field items are SKIPPED (ambiguous — no single value to inject).
#   - reserved env names (PATH, LD_PRELOAD, NODE_OPTIONS) are REJECTED.
#   - hard cap of 256 items.
#   - NOTHING is written to disk: values live only in the child's environment
#     and vanish when it exits. (Contrast `abadge mount`, which writes a 0600
#     temp file.)
# Every injection — allowed or denied — is recorded in the audit log.
printf '%s' "$ABADGE_SESSION_TOKEN" | abadge run --all --token-stdin -- ./deploy.sh

# ---------------------------------------------------------------------------
# Audit summary: confirm what the agent accessed during this run.
# ---------------------------------------------------------------------------
# Pipe the bearer again — separate invocation, separate stdin.
printf '%s' "$ABADGE_SESSION_TOKEN" \
  | abadge audit --json --limit 20 --token-stdin \
  | jq -r '.entries[] | "\(.occurredAt)  \(.eventType)  \(.result)  \(.itemId // "-")"'
