#!/usr/bin/env bash
# Generates dev environment files from Doppler environment variables:
#   apps/api/.dev.vars   — Cloudflare Worker bindings
#   apps/web/.env.local  — Next.js env vars
#
# Run via: bun run dev:vars  (which wraps this with `doppler run`)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

write_var() {
  local file="$1" key="$2" value="$3"
  if [ -n "$value" ]; then
    echo "${key}=${value}" >> "$file"
  fi
}

# --- API worker (apps/api/.dev.vars) ---

API_FILE="$REPO_ROOT/apps/api/.dev.vars"
: > "$API_FILE"

while IFS= read -r key || [ -n "$key" ]; do
  write_var "$API_FILE" "$key" "${!key:-}"
done < <(grep -v '^#' "$SCRIPT_DIR/worker-env-keys.txt" | grep -v '^$')

echo "Generated $API_FILE ($(wc -l < "$API_FILE" | tr -d ' ') vars)"

# --- Web app (apps/web/.env.local) ---

WEB_FILE="$REPO_ROOT/apps/web/.env.local"
: > "$WEB_FILE"

write_var "$WEB_FILE" "ABADGE_API_URL" "${ABADGE_API_URL:-}"
write_var "$WEB_FILE" "ABADGE_APP_URL" "${ABADGE_APP_URL:-}"

echo "Generated $WEB_FILE ($(wc -l < "$WEB_FILE" | tr -d ' ') vars)"
