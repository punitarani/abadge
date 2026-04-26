#!/bin/bash
# E2E test harness for multi-capability permission grants.
# Hits a real running API on http://localhost:8787 with a real DB.

set -uo pipefail
SESSION="$(cat /tmp/session8.txt)"
API="http://localhost:8787"
CLI="$PWD/packages/cli/dist/abadge"

PASS=0
FAIL=0
declare -a FAILURES

trpc() {
  local proc="$1" body="$2" org="${3:-}"
  if [ -n "$org" ]; then
    curl -s -X POST "$API/trpc/$proc" \
      -H "Authorization: Bearer $SESSION" \
      -H "X-Abadge-Org-Id: $org" \
      -H "Content-Type: application/json" \
      -d "$body"
  else
    curl -s -X POST "$API/trpc/$proc" \
      -H "Authorization: Bearer $SESSION" \
      -H "Content-Type: application/json" \
      -d "$body"
  fi
}

trpc_q() {
  local proc="$1" input="$2" org="${3:-}"
  curl -s -G "$API/trpc/$proc" \
    -H "Authorization: Bearer $SESSION" \
    ${org:+-H "X-Abadge-Org-Id: $org"} \
    --data-urlencode "input=$input"
}

ok() { echo "  🟢 $1"; PASS=$((PASS+1)); }
fail() { echo "  🔴 $1: $2"; FAIL=$((FAIL+1)); FAILURES+=("$1: $2"); }
hdr() { echo; echo "=== $1 ==="; }

err_code() {
  echo "$1" | jq -r '.error.data.code // .error.data.cause.code // .error.json.data.code // "none"' 2>/dev/null
}

err_meta() {
  local field="$2"
  echo "$1" | jq -r ".error.json.data.cause.meta.$field // .error.json.data.meta.$field" 2>/dev/null
}

hdr "Setup: org + profile + items + agents (single-org user)"
ORG=$(trpc organizations.create '{"name":"E2E Org Final","slug":"e2e-org-final"}')
ORG_ID=$(echo "$ORG" | jq -r '.result.data.organization.id')
echo "  orgId=$ORG_ID"

PROFILE=$(trpc profiles.create "{\"orgId\":\"$ORG_ID\",\"name\":\"e2e-default\",\"storageMode\":\"server_managed\"}" "$ORG_ID")
PROFILE_ID=$(echo "$PROFILE" | jq -r '.result.data.profile.id')
echo "  profileId=$PROFILE_ID"

mkitem() {
  local label="$1"
  local body="{\"storageMode\":\"server_managed\",\"payload\":{\"label\":\"$label\",\"kind\":\"token\",\"fields\":{\"value\":\"sec-$label\"}}}"
  trpc items.create "$body" "$ORG_ID" | jq -r '.result.data.id'
}

mkagent() {
  local name="$1" kind="$2"
  trpc agents.create "{\"name\":\"$name\",\"kind\":\"$kind\",\"authMethod\":\"legacy_api_key\"}" "$ORG_ID" \
    | jq -r '.result.data.agent.id'
}

ITEM_A=$(mkitem "item-a")
ITEM_B=$(mkitem "item-b")
ITEM_C=$(mkitem "item-c")
ITEM_D=$(mkitem "item-d")
ITEM_E=$(mkitem "item-e")
echo "  items: A=$ITEM_A B=$ITEM_B C=$ITEM_C D=$ITEM_D E=$ITEM_E"

AGENT_LOCAL=$(mkagent "local-1" "local_cli")
AGENT_REMOTE=$(mkagent "remote-1" "remote")
AGENT_MCP=$(mkagent "mcp-1" "local_mcp")
echo "  agents: local=$AGENT_LOCAL remote=$AGENT_REMOTE mcp=$AGENT_MCP"

# ===== HAPPY: 3 single-cap variations =====
hdr "2.A.1 happy: single-cap (local + SM + mount_env) on item A"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_A\",\"capabilities\":[\"mount_env\"]}" "$ORG_ID")
LEN=$(echo "$RESP" | jq -r '.result.data.permissions | length')
[ "$LEN" = "1" ] && ok "1 row, capability=mount_env" || fail "2.A.1" "len=$LEN, raw=$(echo $RESP | head -c 150)"

hdr "2.A.2 happy: single-cap (remote + SM + reveal_plaintext) on item A"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_REMOTE\",\"itemId\":\"$ITEM_A\",\"capabilities\":[\"reveal_plaintext\"]}" "$ORG_ID")
[ "$(echo $RESP | jq -r '.result.data.permissions[0].capability')" = "reveal_plaintext" ] && ok "remote+SM reveal_plaintext" || fail "2.A.2" "raw=$(echo $RESP | head -c 150)"

hdr "2.A.3 happy: single-cap (mcp + SM + mount_file) on item A"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_MCP\",\"itemId\":\"$ITEM_A\",\"capabilities\":[\"mount_file\"]}" "$ORG_ID")
[ "$(echo $RESP | jq -r '.result.data.permissions[0].capability')" = "mount_file" ] && ok "mcp+SM mount_file" || fail "2.A.3" "raw=$(echo $RESP | head -c 150)"

# ===== HAPPY: 3 batch variations =====
hdr "2.B.1 happy batch: 3-cap (local + SM + [reveal, mount_env, mount_file]) on item B"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_B\",\"capabilities\":[\"reveal_plaintext\",\"mount_env\",\"mount_file\"]}" "$ORG_ID")
LEN=$(echo "$RESP" | jq -r '.result.data.permissions | length')
[ "$LEN" = "3" ] && ok "3 rows in transaction" || fail "2.B.1" "len=$LEN"

hdr "2.B.2 happy batch: 3-cap with shared expiry on item C"
EXP=$(date -u -v+7d "+%Y-%m-%dT%H:%M:%SZ")
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_C\",\"capabilities\":[\"reveal_plaintext\",\"mount_env\",\"mount_file\"],\"expiresAt\":\"$EXP\"}" "$ORG_ID")
EXP_COUNT=$(echo "$RESP" | jq -r '[.result.data.permissions[] | select(.expiresAt != null)] | length')
[ "$EXP_COUNT" = "3" ] && ok "3 rows all with expiresAt" || fail "2.B.2" "exp count=$EXP_COUNT"

hdr "2.B.3 happy batch: 2-cap (mcp + SM + [reveal, mount_env]) on item D"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_MCP\",\"itemId\":\"$ITEM_D\",\"capabilities\":[\"reveal_plaintext\",\"mount_env\"]}" "$ORG_ID")
LEN=$(echo "$RESP" | jq -r '.result.data.permissions | length')
[ "$LEN" = "2" ] && ok "2 rows" || fail "2.B.3" "len=$LEN"

# ===== ADVERSARIAL: matrix violations =====
hdr "2.C.1 adv: local + SM + read_ciphertext (storage)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_E\",\"capabilities\":[\"read_ciphertext\"]}" "$ORG_ID")
[ "$(err_code "$RESP")" = "INVALID_CAPABILITY_STORAGE" ] && ok "INVALID_CAPABILITY_STORAGE" || fail "2.C.1" "code=$(err_code "$RESP")"
META_INV=$(echo "$RESP" | jq -r '.error.data.meta.invalidCapabilities | join(",")')
[ "$META_INV" = "read_ciphertext" ] && ok "meta.invalidCapabilities=[read_ciphertext]" || fail "2.C.1.meta" "got '$META_INV'"

hdr "2.C.2 adv: remote + SM + mount_env (locality)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_REMOTE\",\"itemId\":\"$ITEM_E\",\"capabilities\":[\"mount_env\"]}" "$ORG_ID")
[ "$(err_code "$RESP")" = "INVALID_CAPABILITY_LOCALITY" ] && ok "INVALID_CAPABILITY_LOCALITY" || fail "2.C.2" "code=$(err_code "$RESP")"

hdr "2.C.3 adv: remote + SM + read_ciphertext (locality unreachable in any storage)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_REMOTE\",\"itemId\":\"$ITEM_E\",\"capabilities\":[\"read_ciphertext\"]}" "$ORG_ID")
[ "$(err_code "$RESP")" = "INVALID_CAPABILITY_LOCALITY" ] && ok "INVALID_CAPABILITY_LOCALITY (read_ciphertext for remote)" || fail "2.C.3" "code=$(err_code "$RESP")"

# ===== ADVERSARIAL: mixed batch atomic rollback =====
hdr "2.D.1 adv: mixed valid+invalid batch rolls back (item E)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_E\",\"capabilities\":[\"reveal_plaintext\",\"read_ciphertext\",\"mount_env\"]}" "$ORG_ID")
[ "$(err_code "$RESP")" = "INVALID_CAPABILITY_STORAGE" ] && ok "rejects whole batch" || fail "2.D.1" "code=$(err_code "$RESP")"
LIST=$(trpc_q permissions.list "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_E\"}" "$ORG_ID")
LEN=$(echo "$LIST" | jq -r '.result.data.permissions | length')
[ "$LEN" = "0" ] && ok "rollback verified: 0 rows on (local, itemE)" || fail "2.D.1.rollback" "len=$LEN"

hdr "2.D.2 adv: every cap invalid (remote + ZK item not present, just locality test)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_REMOTE\",\"itemId\":\"$ITEM_E\",\"capabilities\":[\"mount_env\",\"mount_file\",\"read_ciphertext\"]}" "$ORG_ID")
[ "$(err_code "$RESP")" = "INVALID_CAPABILITY_LOCALITY" ] && ok "all 3 caps fail locality" || fail "2.D.2" "code=$(err_code "$RESP")"
META_INV=$(echo "$RESP" | jq -r '.error.data.meta.invalidCapabilities | sort | join(",")')
[ "$META_INV" = "mount_env,mount_file,read_ciphertext" ] && ok "meta lists all 3 offenders" || fail "2.D.2.meta" "got '$META_INV'"

hdr "2.D.3 adv: storage violation in 2-cap batch (read_ciphertext + reveal)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_E\",\"capabilities\":[\"read_ciphertext\",\"reveal_plaintext\"]}" "$ORG_ID")
[ "$(err_code "$RESP")" = "INVALID_CAPABILITY_STORAGE" ] && ok "rejects whole 2-cap batch" || fail "2.D.3" "code=$(err_code "$RESP")"

# ===== ADVERSARIAL: duplicate handling =====
hdr "2.E.1 adv: pre-grant overlap on item B (mount_env, mount_file already exist)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_B\",\"capabilities\":[\"mount_env\",\"mount_file\"]}" "$ORG_ID")
[ "$(err_code "$RESP")" = "PERMISSION_ALREADY_EXISTS" ] && ok "PERMISSION_ALREADY_EXISTS" || fail "2.E.1" "code=$(err_code "$RESP")"
DUPS=$(echo "$RESP" | jq -r '.error.data.meta.duplicateCapabilities | sort | join(",")')
[ "$DUPS" = "mount_env,mount_file" ] && ok "meta.duplicateCapabilities lists both" || fail "2.E.1.meta" "got '$DUPS'"

hdr "2.E.2 adv: in-input duplicate [mount_env, mount_env]"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_E\",\"capabilities\":[\"mount_env\",\"mount_env\"]}" "$ORG_ID")
ERR=$(err_code "$RESP")
[[ "$ERR" == "BAD_REQUEST" ]] && ok "schema rejects in-input duplicate ($ERR)" || fail "2.E.2" "code=$ERR"

hdr "2.E.3 adv: empty capabilities array"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_E\",\"capabilities\":[]}" "$ORG_ID")
ERR=$(err_code "$RESP")
[[ "$ERR" == "BAD_REQUEST" ]] && ok "schema rejects empty array ($ERR)" || fail "2.E.3" "code=$ERR"

# ===== EDGE: list filter combinations =====
hdr "2.G.1 list({agentId, itemId}) AND-combined"
RESP=$(trpc_q permissions.list "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_B\"}" "$ORG_ID")
LEN=$(echo "$RESP" | jq -r '.result.data.permissions | length')
[ "$LEN" = "3" ] && ok "AND filter: 3 rows on (local, itemB)" || fail "2.G.1" "len=$LEN"

hdr "2.G.2 list({agentId}) only — across items"
RESP=$(trpc_q permissions.list "{\"agentId\":\"$AGENT_LOCAL\"}" "$ORG_ID")
LEN=$(echo "$RESP" | jq -r '.result.data.permissions | length')
# A:mount_env (1) + B:[reveal, mount_env, mount_file] (3) + C:[reveal, mount_env, mount_file] (3) = 7
[ "$LEN" -ge "7" ] && ok "agent has $LEN grants" || fail "2.G.2" "len=$LEN"

hdr "2.G.3 list({}) returns all caller-visible perms"
RESP=$(trpc_q permissions.list "{}" "$ORG_ID")
LEN=$(echo "$RESP" | jq -r '.result.data.permissions | length')
[ "$LEN" -ge "10" ] && ok "$LEN total perms in org" || fail "2.G.3" "len=$LEN"

# ===== EDGE: per-row revoke =====
hdr "2.H.1 per-row revoke: revoke mount_env on item B, leave reveal+mount_file"
TARGET=$(trpc_q permissions.list "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_B\"}" "$ORG_ID" | \
  jq -r '.result.data.permissions[] | select(.capability=="mount_env") | .id')
trpc permissions.revoke "{\"permissionId\":\"$TARGET\"}" "$ORG_ID" > /dev/null
LIST=$(trpc_q permissions.list "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_B\"}" "$ORG_ID")
REMAINING=$(echo "$LIST" | jq -r '.result.data.permissions | map(.capability) | sort | join(",")')
[ "$REMAINING" = "mount_file,reveal_plaintext" ] && ok "siblings intact" || fail "2.H.1" "got '$REMAINING'"

hdr "2.H.2 re-grant the revoked cap (no PERMISSION_ALREADY_EXISTS)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_B\",\"capabilities\":[\"mount_env\"]}" "$ORG_ID")
LEN=$(echo "$RESP" | jq -r '.result.data.permissions | length')
[ "$LEN" = "1" ] && ok "re-grant succeeds" || fail "2.H.2" "len=$LEN, code=$(err_code "$RESP")"

hdr "2.H.3 revoke all 3 caps on item C sequentially"
for ID in $(trpc_q permissions.list "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_C\"}" "$ORG_ID" | jq -r '.result.data.permissions[].id'); do
  trpc permissions.revoke "{\"permissionId\":\"$ID\"}" "$ORG_ID" > /dev/null
done
LIST=$(trpc_q permissions.list "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_C\"}" "$ORG_ID")
LEN=$(echo "$LIST" | jq -r '.result.data.permissions | length')
[ "$LEN" = "0" ] && ok "all 3 revoked" || fail "2.H.3" "len=$LEN"

# ===== PENTEST: cross-org / unauth / tampered =====
hdr "Pentest 1: bogus session token"
RESP=$(curl -s -X POST "$API/trpc/permissions.create" \
  -H "Authorization: Bearer fake-token-xyz" \
  -H "X-Abadge-Org-Id: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_A\",\"capabilities\":[\"mount_env\"]}")
ERR=$(err_code "$RESP")
[ "$ERR" = "UNAUTHORIZED" ] && ok "UNAUTHORIZED for bogus token" || fail "Pentest 1" "code=$ERR"

hdr "Pentest 2: no auth at all"
RESP=$(curl -s -X POST "$API/trpc/permissions.create" \
  -H "X-Abadge-Org-Id: $ORG_ID" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_A\",\"capabilities\":[\"mount_env\"]}")
ERR=$(err_code "$RESP")
[ "$ERR" = "UNAUTHORIZED" ] && ok "UNAUTHORIZED with no token" || fail "Pentest 2" "code=$ERR"

hdr "Pentest 3: cross-org agent injection"
ORG2=$(trpc organizations.create '{"name":"Pentest Org","slug":"pentest-org"}')
ORG2_ID=$(echo "$ORG2" | jq -r '.result.data.organization.id')
PROFILE2=$(trpc profiles.create "{\"orgId\":\"$ORG2_ID\",\"name\":\"p2\",\"storageMode\":\"server_managed\"}" "$ORG2_ID")
ITEM2=$(trpc items.create "{\"storageMode\":\"server_managed\",\"payload\":{\"label\":\"x\",\"kind\":\"token\",\"fields\":{\"value\":\"y\"}}}" "$ORG2_ID")
ITEM2_ID=$(echo "$ITEM2" | jq -r '.result.data.id')
AGENT2=$(trpc agents.create '{"name":"a2","kind":"remote","authMethod":"legacy_api_key"}' "$ORG2_ID")
AGENT2_ID=$(echo "$AGENT2" | jq -r '.result.data.agent.id')
# Inject org2's agent ID while operating in org1
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT2_ID\",\"itemId\":\"$ITEM_A\",\"capabilities\":[\"reveal_plaintext\"]}" "$ORG_ID")
ERR=$(err_code "$RESP")
[ "$ERR" = "AGENT_NOT_FOUND" ] && ok "cross-org agent → AGENT_NOT_FOUND" || fail "Pentest 3" "code=$ERR"

hdr "Pentest 4: cross-org item injection"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM2_ID\",\"capabilities\":[\"mount_env\"]}" "$ORG_ID")
ERR=$(err_code "$RESP")
[ "$ERR" = "ITEM_NOT_FOUND" ] && ok "cross-org item → ITEM_NOT_FOUND" || fail "Pentest 4" "code=$ERR"

hdr "Pentest 5: tampered org header (using org2 header in org1 op)"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_A\",\"capabilities\":[\"mount_env\"]}" "$ORG2_ID")
# org1's agent/item not found in org2
ERR=$(err_code "$RESP")
[ "$ERR" = "AGENT_NOT_FOUND" ] && ok "header-org isolation: org1 agent not visible from org2 → $ERR" || fail "Pentest 5" "code=$ERR"

hdr "Pentest 6: huge capabilities array (DoS-flavor)"
HUGE_ARR='["mount_env","mount_env","mount_env","mount_env","mount_env","mount_env","mount_env","mount_env","mount_env","mount_env"]'
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_E\",\"capabilities\":$HUGE_ARR}" "$ORG_ID")
ERR=$(err_code "$RESP")
[ "$ERR" = "BAD_REQUEST" ] && ok "huge dup-only array → schema-level BAD_REQUEST ($ERR)" || fail "Pentest 6" "code=$ERR"

hdr "Pentest 7: SQL-injection-shaped capability value"
RESP=$(trpc permissions.create "{\"agentId\":\"$AGENT_LOCAL\",\"itemId\":\"$ITEM_E\",\"capabilities\":[\"mount_env'; DROP TABLE permissions;--\"]}" "$ORG_ID")
ERR=$(err_code "$RESP")
[ "$ERR" = "BAD_REQUEST" ] && ok "SQL-shaped value → enum schema rejection ($ERR)" || fail "Pentest 7" "code=$ERR"
# Verify the table still exists
COUNT=$(psql -tA postgresql://abadge:abadge@localhost:5432/abadge -c "SELECT count(*) FROM permissions;" 2>&1)
[ "$COUNT" -ge "0" ] && ok "permissions table still queryable (count=$COUNT)" || fail "Pentest 7.table" "table state=$COUNT"

# ===== CLI binary smoke tests =====
# Write a CLI config so the multi-org user has an activeOrgId set
mkdir -p ~/.abadge
cat > ~/.abadge/config.json <<EOF
{"apiUrl":"$API","activeOrgId":"$ORG_ID"}
EOF

hdr "3.1 CLI: repeated --capability flag"
ITEM_F=$(mkitem "item-cli-1")
AGENT_CLI=$(mkagent "cli-test" "local_cli")
CLI_OUT=$(ABADGE_API_URL="$API" ABADGE_SESSION_TOKEN="$SESSION" "$CLI" permission create \
  --agent-id "$AGENT_CLI" --item-id "$ITEM_F" \
  --capability mount_env --capability mount_file 2>&1)
[[ "$CLI_OUT" == *"Granted 2 permissions"* ]] && ok "CLI repeated flag → 2 perms" || fail "3.1" "out=$(echo $CLI_OUT | head -c 200)"

hdr "3.2 CLI: comma-separated --capability"
ITEM_G=$(mkitem "item-cli-2")
AGENT_CLI2=$(mkagent "cli-test-2" "local_cli")
CLI_OUT=$(ABADGE_API_URL="$API" ABADGE_SESSION_TOKEN="$SESSION" "$CLI" permission create \
  --agent-id "$AGENT_CLI2" --item-id "$ITEM_G" \
  --capability mount_env,mount_file,reveal_plaintext 2>&1)
[[ "$CLI_OUT" == *"Granted 3 permissions"* ]] && ok "CLI comma-split → 3 perms" || fail "3.2" "out=$(echo $CLI_OUT | head -c 200)"

hdr "3.3 CLI: PERMISSION_ALREADY_EXISTS surfaces"
CLI_OUT=$(ABADGE_API_URL="$API" ABADGE_SESSION_TOKEN="$SESSION" "$CLI" permission create \
  --agent-id "$AGENT_CLI2" --item-id "$ITEM_G" \
  --capability mount_env --capability reveal_plaintext 2>&1)
[[ "$CLI_OUT" == *"already exist"* || "$CLI_OUT" == *"PERMISSION_ALREADY"* ]] && ok "CLI surfaces conflict" || fail "3.3" "out=$(echo $CLI_OUT | head -c 200)"

hdr "3.4 CLI: in-input dup rejected before SDK call"
CLI_OUT=$(ABADGE_API_URL="$API" ABADGE_SESSION_TOKEN="$SESSION" "$CLI" permission create \
  --agent-id "$AGENT_CLI2" --item-id "$ITEM_G" \
  --capability mount_env,mount_env 2>&1)
[[ "$CLI_OUT" == *"Duplicate"* ]] && ok "client-side dup check fires" || fail "3.4" "out=$(echo $CLI_OUT | head -c 200)"

hdr "3.5 CLI: list returns all caps for an agent"
CLI_LIST=$(ABADGE_API_URL="$API" ABADGE_SESSION_TOKEN="$SESSION" "$CLI" permission list \
  --agent-id "$AGENT_CLI2" --json 2>&1)
LEN=$(echo "$CLI_LIST" | jq '. | length' 2>/dev/null)
[ "$LEN" = "3" ] && ok "CLI list → 3 rows" || fail "3.5" "len=$LEN"

hdr "3.6 CLI: matrix violation surfaces with hint"
CLI_OUT=$(ABADGE_API_URL="$API" ABADGE_SESSION_TOKEN="$SESSION" "$CLI" permission create \
  --agent-id "$AGENT_CLI2" --item-id "$ITEM_G" \
  --capability read_ciphertext 2>&1)
[[ "$CLI_OUT" == *"INVALID_CAPABILITY"* || "$CLI_OUT" == *"not available"* ]] && ok "CLI surfaces matrix error" || fail "3.6" "out=$(echo $CLI_OUT | head -c 200)"

# ===== AUDIT LOG VERIFICATION =====
hdr "Audit: 3-cap batch produces 3 rows, revoke produces 1"
PRE=$(psql -tA postgresql://abadge:abadge@localhost:5432/abadge -c "SELECT count(*) FROM audit_logs WHERE event_type='permission.create' AND organization_id='$ORG_ID';")
echo "  permission.create rows in DB: $PRE"
[ "$PRE" -ge "10" ] && ok "≥10 permission.create audit rows for org's batched grants" || fail "audit count" "count=$PRE"
REV=$(psql -tA postgresql://abadge:abadge@localhost:5432/abadge -c "SELECT count(*) FROM audit_logs WHERE event_type='permission.revoke' AND organization_id='$ORG_ID';")
[ "$REV" -ge "4" ] && ok "≥4 permission.revoke audit rows" || fail "revoke audit" "count=$REV"

echo
echo "============================="
echo "  TALLY: $PASS pass / $FAIL fail"
echo "============================="
if [ $FAIL -gt 0 ]; then
  echo "Failures:"
  for f in "${FAILURES[@]}"; do echo "  - $f"; done
fi
exit $FAIL
