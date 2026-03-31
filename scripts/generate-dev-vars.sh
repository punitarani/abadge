#!/usr/bin/env bash
# Generates apps/api/.dev.vars from Doppler environment variables.
# Run via: bun run dev:vars

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTFILE="$REPO_ROOT/apps/api/.dev.vars"
KEYS_FILE="$SCRIPT_DIR/worker-env-keys.txt"

if [ ! -f "$KEYS_FILE" ]; then
  echo "Missing worker env key list: $KEYS_FILE" >&2
  exit 1
fi

: > "$OUTFILE"

while IFS= read -r key || [ -n "$key" ]; do
  case "$key" in
    ""|\#*)
      continue
      ;;
  esac

  value="${!key:-}"
  if [ -n "$value" ]; then
    echo "${key}=${value}" >> "$OUTFILE"
  fi
done < "$KEYS_FILE"

echo "Generated $OUTFILE with $(wc -l < "$OUTFILE" | tr -d ' ') vars"
