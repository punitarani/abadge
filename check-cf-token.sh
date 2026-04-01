#!/usr/bin/env bash
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"

api="https://api.cloudflare.com/client/v4"

echo "Token length: ${#CLOUDFLARE_API_TOKEN}"

echo
echo "1) Raw token verify response"
curl -sS "${api}/user/tokens/verify" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq

echo
echo "2) Raw account access response"
curl -sS "${api}/accounts/${CLOUDFLARE_ACCOUNT_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq
