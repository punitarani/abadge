#!/usr/bin/env bash
#
# abadge — raw-REST management example (pure curl, no SDK).
#
# Manage abadge from ANY language or runtime that can speak HTTP. This script
# uses an `abu_` PERSONAL API KEY to drive the management surface:
#   1. create a server_managed item in a profile
#   2. register a remote agent and issue a one-time bootstrap token
#   3. grant that agent a "read" permission on the item
#   4. read the audit log
#
# TRUST MODEL — read this before you copy anything:
#   An `abu_` personal API key authenticates the MANAGEMENT surface ONLY.
#   It can create items/agents/permissions and read the audit trail, but it
#   CANNOT call /v1/access/* (read/use a secret VALUE). Reading a secret
#   requires an AGENT identity: an Ed25519 keypair agent that exchanges a
#   signed challenge for a short-lived `abs_` session token, then presents an
#   explicit per-(agent,item,capability) permission. That flow is example 09.
#   This separation is the whole point of abadge: the credential that manages
#   the vault is never the credential that can read secrets out of it.

set -euo pipefail

# --- Configuration (read from the environment; never hardcode secrets) -------
# ABADGE_API_URL  Base URL of the API, e.g. https://api.abadge.dev
# ABADGE_API_KEY  A personal API key (prefix abu_). Mint one in the dashboard:
#                 Settings -> "API keys". It is shown once.
# ABADGE_ORG_ID   The organization id this key is bound to.
: "${ABADGE_API_URL:?set ABADGE_API_URL, e.g. https://api.abadge.dev}"
: "${ABADGE_API_KEY:?set ABADGE_API_KEY to an abu_ personal API key}"
: "${ABADGE_ORG_ID:?set ABADGE_ORG_ID to your organization id}"

# All v1 routes live under <base>/v1.
BASE="${ABADGE_API_URL%/}/v1"

# --- Request helper ----------------------------------------------------------
# Every authenticated management request needs the same three headers:
#   Authorization: Bearer <abu_ key>   — who/what is calling
#   X-Abadge-Org-Id: <orgId>           — which org's data (required on auth'd routes)
#   Content-Type: application/json     — the body encoding
#
# Usage: api METHOD PATH [JSON_BODY]
# Prints the raw JSON response body to stdout. We do NOT pass -f / --fail here:
# on a 4xx the server returns a structured { code, message, hint, meta }
# envelope that is far more useful than curl's generic failure — see the
# error-handling note at the bottom of this file.
api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "${BASE}${path}" \
      -H "Authorization: Bearer ${ABADGE_API_KEY}" \
      -H "X-Abadge-Org-Id: ${ABADGE_ORG_ID}" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -sS -X "$method" "${BASE}${path}" \
      -H "Authorization: Bearer ${ABADGE_API_KEY}" \
      -H "X-Abadge-Org-Id: ${ABADGE_ORG_ID}" \
      -H "Content-Type: application/json"
  fi
}

# ============================================================================
# 1. Create a server_managed item
# ----------------------------------------------------------------------------
# server_managed = abadge encrypts the value with AES-256-GCM server-side. The
# request body shape is EXACT: storageMode + a payload envelope. The actual
# secret lives in payload.fields. "value" is the standard single-field name.
# Omit profileId to land in the org's default server_managed profile.
# Response: { "id": "<itemId>" }.
echo "==> Creating server_managed item..."
ITEM_BODY='{
  "storageMode": "server_managed",
  "payload": {
    "v": 1,
    "label": "Deploy webhook key",
    "kind": "api_key",
    "tags": ["ci", "example"],
    "fields": { "value": "sk_example_DO_NOT_USE_replace_me" }
  }
}'
ITEM_ID="$(api POST /items "$ITEM_BODY" | jq -er '.id')"
echo "    item id: ${ITEM_ID}"

# ============================================================================
# 2. Register a remote agent (issue a one-time bootstrap token)
# ----------------------------------------------------------------------------
# kind:"remote" = a service account that runs off-device (CI, a server).
# issueBootstrapToken:true = mint a one-time `abe_`/bootstrap token (10-min TTL)
# the agent later redeems by enrolling its Ed25519 public key. We do NOT send a
# publicKey here, so the agent enrolls later (see example 09).
# Response: { "agent": { "id": ... }, "bootstrapToken": "...", "bootstrapExpiresAt": "..." }.
echo "==> Registering remote agent..."
AGENT_BODY='{
  "name": "ci-deploy-bot",
  "kind": "remote",
  "issueBootstrapToken": true
}'
AGENT_RESP="$(api POST /agents "$AGENT_BODY")"
AGENT_ID="$(echo "$AGENT_RESP" | jq -er '.agent.id')"
BOOTSTRAP_TOKEN="$(echo "$AGENT_RESP" | jq -er '.bootstrapToken')"
echo "    agent id:        ${AGENT_ID}"
# The bootstrap token is shown ONCE. Hand it to the agent out-of-band; it is the
# only way that agent enrolls its keypair. Do not log it in real systems.
echo "    bootstrap token: ${BOOTSTRAP_TOKEN}"

# ============================================================================
# 3. Grant a permission: this agent may "read" this item
# ----------------------------------------------------------------------------
# The field is "capabilities" (a NON-EMPTY array), never "capability".
# Canonical caps: "read" (reveal the value) and "use" (mount into env/file).
# Granting "read" does NOT let this abu_ key read the value — only the AGENT,
# once it holds an abs_ session, can exercise this grant via /v1/access/*.
# Response: { "permissions": [ ... ] }.
echo "==> Granting read permission..."
PERM_BODY="$(jq -n --arg a "$AGENT_ID" --arg i "$ITEM_ID" \
  '{ agentId: $a, itemId: $i, capabilities: ["read"] }')"
api POST /permissions "$PERM_BODY" | jq '.permissions'

# ============================================================================
# 4. Read the audit log
# ----------------------------------------------------------------------------
# Every management mutation and every agent access attempt is appended here.
# GET /v1/audit?limit=10. Response: { "entries": [...], "nextCursor": "...|null" }.
echo "==> Last 10 audit entries..."
api GET "/audit?limit=10" | jq '.entries'

echo "==> Done."

# ----------------------------------------------------------------------------
# ERROR HANDLING
# ----------------------------------------------------------------------------
# Every error (any non-2xx) returns the same envelope:
#   { "code": "...", "message": "...", "hint": "...|null", "meta": {...}|null }
# Branch on `code` (stable), show `message`/`hint` to humans, read `meta` for
# structured details. Example: an abu_ key calling the agent-only access
# surface is rejected —
#
#   $ curl -sS -X POST "${BASE}/access/${ITEM_ID}/read" \
#       -H "Authorization: Bearer ${ABADGE_API_KEY}" \
#       -H "X-Abadge-Org-Id: ${ABADGE_ORG_ID}" \
#       -H "Content-Type: application/json" \
#       -d "{\"itemId\":\"${ITEM_ID}\"}"
#   {
#     "code": "UNAUTHORIZED",
#     "message": "Agent authentication required",
#     "hint": "This endpoint needs an abs_ agent session. A personal API key cannot read secret values.",
#     "meta": null
#   }
#
# That rejection is the trust model working as designed, not a bug: to read the
# value, authenticate as the AGENT (Ed25519 -> abs_ session) — see example 09.
