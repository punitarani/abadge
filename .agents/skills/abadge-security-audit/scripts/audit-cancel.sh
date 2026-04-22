#!/usr/bin/env bash
# audit-cancel.sh — mark an active audit as cancelled (no deletion).
#
# Usage: audit-cancel.sh [run-id] [--reason "<text>"]

set -euo pipefail

REASON=""
RUN_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) REASON="${2:-}"; shift 2;;
    *) RUN_ID="$1"; shift;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUDITS_ROOT="$REPO_ROOT/docs/security-audit"

if [[ -n "$RUN_ID" ]]; then
  STATE_DIR="$AUDITS_ROOT/$RUN_ID/state"
else
  STATE_DIR="$(find "$AUDITS_ROOT" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null \
    | head -n 1 \
    | xargs dirname 2>/dev/null || true)"
fi

if [[ -z "${STATE_DIR:-}" ]] || [[ ! -f "$STATE_DIR/active.yaml" ]]; then
  echo "No audit state found under $AUDITS_ROOT" >&2
  exit 1
fi

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Portable in-place edit: write temp, move
tmp=$(mktemp)
awk -v now="$NOW" -v reason="$REASON" '
  /^status:/         {print "status: cancelled"; next}
  /^cancelled_at:/   {print "cancelled_at: " now; next}
  /^notes:/          {print; print "  cancelled_at " now " reason: " reason; skip=1; next}
  skip && /^[^ ]/    {skip=0}
  {print}
' "$STATE_DIR/active.yaml" > "$tmp"
mv "$tmp" "$STATE_DIR/active.yaml"

# Remove ralph-loop state file so the loop does not re-fire
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
[[ -f "$RALPH_STATE" ]] && rm "$RALPH_STATE" && echo "removed $RALPH_STATE"

cat <<MSG
Audit marked cancelled.
  state_dir: $STATE_DIR
  at:        $NOW
  reason:    ${REASON:-(none)}

Findings and notes retained. Re-run audit-init.sh with a new run-id to start over.
MSG
