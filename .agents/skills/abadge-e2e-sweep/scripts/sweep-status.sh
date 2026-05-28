#!/usr/bin/env bash
# sweep-status.sh — print live status of the active sweep (read-only)
#
# Usage: sweep-status.sh [run-id]
#   run-id : optional; defaults to the most-recent run with status=active

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SWEEPS_DIR="$REPO_ROOT/docs/superpowers/sweeps"

if [[ -n "${1:-}" ]]; then
  RUN_ID="$1"
  STATE_DIR="$SWEEPS_DIR/$RUN_ID/state"
else
  # find most recently modified active.yaml
  STATE_DIR="$(find "$SWEEPS_DIR" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null \
    | head -n 1 \
    | xargs dirname 2>/dev/null || true)"
fi

if [[ -z "${STATE_DIR:-}" ]] || [[ ! -f "$STATE_DIR/active.yaml" ]]; then
  echo "No sweep state found under $SWEEPS_DIR" >&2
  exit 1
fi

echo "=== Sweep Status ==="
echo "state_dir: $STATE_DIR"
echo
echo "--- active.yaml ---"
# Strip leading YAML fence if present; print everything else. Prior attempt
# used sed range matching on paired ---, but active.yaml has only the opener
# so the range never closed and output was empty.
sed '1{/^---$/d;}; /^---$/,$d' "$STATE_DIR/active.yaml"
echo
echo "--- progress.yaml ---"
head -30 "$STATE_DIR/progress.yaml"
echo
echo "--- recent iter log (first 40 lines — newest-first) ---"
# iteration-log.md is written newest-first, so head shows latest entries.
head -n 40 "$STATE_DIR/iteration-log.md"
echo
echo "--- recent issues (last 30 lines) ---"
tail -n 30 "$STATE_DIR/issues.md"
echo
echo "--- ralph-loop state ---"
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
if [[ -f "$RALPH_STATE" ]]; then
  echo "ACTIVE  iteration=$(grep '^iteration:' "$RALPH_STATE" | sed 's/iteration: *//')"
else
  echo "INACTIVE  (no .claude/ralph-loop.local.md)"
fi
