#!/usr/bin/env bash
# sweep-cancel.sh — stop the active ralph-loop AND mark sweep state cancelled (preserved)
#
# Usage: sweep-cancel.sh [run-id]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SWEEPS_DIR="$REPO_ROOT/docs/superpowers/sweeps"

if [[ -n "${1:-}" ]]; then
  STATE_DIR="$SWEEPS_DIR/$1/state"
else
  STATE_DIR="$(find "$SWEEPS_DIR" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null \
    | head -n 1 \
    | xargs dirname 2>/dev/null || true)"
fi

if [[ -z "${STATE_DIR:-}" ]] || [[ ! -f "$STATE_DIR/active.yaml" ]]; then
  echo "No sweep state found." >&2
  exit 1
fi

# Inspect ralph state — only remove if session matches
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
RALPH_REMOVED=no
if [[ -f "$RALPH_STATE" ]]; then
  RALPH_SESSION="$(grep '^session_id:' "$RALPH_STATE" | sed 's/session_id: *//' || true)"
  CUR_SESSION="${CLAUDE_CODE_SESSION_ID:-}"
  if [[ -z "$RALPH_SESSION" ]] || [[ "$RALPH_SESSION" == "$CUR_SESSION" ]]; then
    rm "$RALPH_STATE"
    RALPH_REMOVED=yes
  else
    echo "WARN: ralph-loop state belongs to session $RALPH_SESSION (not this one);" >&2
    echo "      cancel from THAT session, or rm .claude/ralph-loop.local.md manually." >&2
  fi
fi

# Mark active.yaml cancelled (atomic)
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TMP="$STATE_DIR/active.yaml.tmp.$$"
sed "s/^status:.*/status: cancelled/" "$STATE_DIR/active.yaml" \
  | sed "s/^cancelled_at:.*/cancelled_at: $NOW/" > "$TMP"
mv "$TMP" "$STATE_DIR/active.yaml"

# Append to iteration log
echo "iter cancel · $NOW · sweep-cancel.sh invoked · ralph_removed=$RALPH_REMOVED" \
  >> "$STATE_DIR/iteration-log.md"

echo "Sweep cancelled. State preserved at $STATE_DIR"
echo "  ralph removed: $RALPH_REMOVED"
echo "  Use /abadge-e2e-sweep report  to render REPORT.md"
