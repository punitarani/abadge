#!/usr/bin/env bash
# audit-status.sh — read-only live status of the security audit.
#
# Usage: audit-status.sh [run-id]
#   run-id : optional; defaults to most-recent run with status=active.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUDITS_ROOT="$REPO_ROOT/docs/security-audit"

if [[ -n "${1:-}" ]]; then
  STATE_DIR="$AUDITS_ROOT/$1/state"
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

AUDIT_DIR="$(dirname "$STATE_DIR")"

echo "=== abadge-security-audit status ==="
echo "audit_dir: $AUDIT_DIR"
echo
echo "--- active.yaml ---"
head -30 "$STATE_DIR/active.yaml"
echo
echo "--- progress.yaml ---"
head -40 "$STATE_DIR/progress.yaml"
echo
echo "--- finding counts by severity ---"
for sev in critical high medium low informational; do
  n=$(find "$AUDIT_DIR/findings/$sev" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  printf "  %-15s %s\n" "$sev" "$n"
done
merged=$(find "$AUDIT_DIR/findings/merged" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
printf "  %-15s %s\n" "merged" "$merged"
echo
echo "--- latest 10 findings ---"
find "$AUDIT_DIR/findings" -maxdepth 2 -name '*.md' -not -path '*/merged/*' 2>/dev/null \
  | xargs ls -t 2>/dev/null \
  | head -10 \
  | sed "s|$AUDIT_DIR/||"
echo
echo "--- recent wave reports ---"
ls -t "$AUDIT_DIR/wave-reports"/*.md 2>/dev/null | head -5 | sed "s|$AUDIT_DIR/||"
echo
echo "--- pen-tests filed ---"
n_pen=$(find "$AUDIT_DIR/pen-tests" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
echo "  count: $n_pen"
echo
echo "--- ralph-loop state ---"
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
if [[ -f "$RALPH_STATE" ]]; then
  iter=$(grep '^iteration:' "$RALPH_STATE" 2>/dev/null | head -1 | sed 's/iteration: *//')
  echo "  ACTIVE  iteration=${iter:-?}"
else
  echo "  INACTIVE  (no .claude/ralph-loop.local.md)"
fi
