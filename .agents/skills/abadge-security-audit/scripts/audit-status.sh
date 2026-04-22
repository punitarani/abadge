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
# NUL-delimited through xargs so filenames with spaces/quotes don't break.
find "$AUDIT_DIR/findings" -maxdepth 2 -name '*.md' -not -path '*/merged/*' -print0 2>/dev/null \
  | xargs -0 ls -t 2>/dev/null \
  | head -10 \
  | sed "s|$AUDIT_DIR/||"
echo
echo "--- recent wave reports ---"
find "$AUDIT_DIR/wave-reports" -maxdepth 1 -name '*.md' -print0 2>/dev/null \
  | xargs -0 ls -t 2>/dev/null \
  | head -5 \
  | sed "s|$AUDIT_DIR/||"
echo
echo "--- pen-tests filed ---"
n_pen=$(find "$AUDIT_DIR/pen-tests" -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
echo "  count: $n_pen"
echo
echo "--- ralph-loop state ---"
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
if [[ -f "$RALPH_STATE" ]]; then
  iter=$(grep '^iteration:' "$RALPH_STATE" 2>/dev/null | head -1 | sed 's/iteration: *//')
  max=$(grep '^max_iterations:' "$RALPH_STATE" 2>/dev/null | head -1 | sed 's/max_iterations: *//')
  rsess=$(grep '^session_id:' "$RALPH_STATE" 2>/dev/null | head -1 | sed 's/session_id: *//')
  asess=$(grep '^session_id:' "$STATE_DIR/active.yaml" 2>/dev/null | head -1 | sed 's/session_id: *//')
  mtime=$(stat -f %m "$RALPH_STATE" 2>/dev/null || stat -c %Y "$RALPH_STATE" 2>/dev/null || echo 0)
  age=$(( $(date +%s) - mtime ))
  echo "  ACTIVE  iteration=${iter:-?} / ${max:-?}  (last write: ${age}s ago)"
  echo "  ralph session_id=\"$rsess\"   active.yaml session_id=\"$asess\""
  if [[ "$rsess" != "$asess" && -n "$rsess" && -n "$asess" ]]; then
    echo "  ⚠ session_id mismatch — stop-hook may not re-fire in this session."
    echo "     FIX:  audit-recover.sh set-session --apply"
  fi
  # Zombie hint: fresh ralph mtime beside stale iteration-log mtime.
  if [[ -f "$STATE_DIR/iteration-log.md" ]]; then
    log_mtime=$(stat -f %m "$STATE_DIR/iteration-log.md" 2>/dev/null || stat -c %Y "$STATE_DIR/iteration-log.md" 2>/dev/null || echo 0)
    log_age=$(( $(date +%s) - log_mtime ))
    if [[ $age -lt 300 && $log_age -gt 900 ]]; then
      echo "  ⚠ zombie-driver pattern: ralph fresh (${age}s) but iteration-log stale ($((log_age/60)) min)."
      echo "     Run audit-doctor.sh for details."
    fi
  fi
  # Budget warning
  if [[ "$iter" =~ ^[0-9]+$ && "$max" =~ ^[0-9]+$ && "$max" -gt 0 ]]; then
    remaining=$(( max - iter ))
    if [[ $remaining -le 5 ]]; then
      echo "  ⚠ only $remaining iteration(s) left before max_iterations — audit-recover.sh bump-max 80 --apply"
    fi
  fi
else
  echo "  INACTIVE  (no .claude/ralph-loop.local.md). To continue: audit-resume.sh"
fi
