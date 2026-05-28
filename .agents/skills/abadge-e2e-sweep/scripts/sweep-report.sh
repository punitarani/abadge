#!/usr/bin/env bash
# sweep-report.sh — render a markdown report from sweep state
#
# Usage: sweep-report.sh [run-id]
# Writes the controller's reporter output to state/REPORT.md (the controller
# is the one calling the reporter subagent; this script just locates the
# state dir, prints paths, and exists. The actual rendering is done in-Claude
# via subagents/reporter-prompt.md.)

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

if [[ -z "${STATE_DIR:-}" ]]; then
  echo "No sweep state found." >&2
  exit 1
fi

cat <<MSG
Render the report by dispatching the reporter subagent
(subagents/reporter-prompt.md) with these inputs:

active.yaml:        $STATE_DIR/active.yaml
plan.yaml:          $STATE_DIR/plan.yaml
progress.yaml:      $STATE_DIR/progress.yaml
issues.md:          $STATE_DIR/issues.md
checkpoints.md:     $STATE_DIR/checkpoints.md
iteration-log tail: $(tail -n 100 "$STATE_DIR/iteration-log.md" 2>/dev/null | wc -l) lines

Save subagent output to: $STATE_DIR/REPORT.md
MSG
