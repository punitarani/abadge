#!/usr/bin/env bash
# audit-resume.sh — continue an existing audit run in place.
#
# Resume NEVER creates a new run, NEVER overwrites audit memory, and NEVER
# rewrites active.yaml's run-config fields. It only re-attaches the
# ralph-loop driver to state that already exists and names the current
# Claude Code session as the owner.
#
# Usage: audit-resume.sh [run-id] [--session-id <id>]
#   run-id       : optional; defaults to the most-recent active run.
#   --session-id : optional; defaults to $CLAUDE_CODE_SESSION_ID.
#
# Refuses if active.yaml is missing (nothing to resume → use start),
# cancelled (use audit-recover.sh uncancel --apply first), or completed
# (start a new run instead).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUDITS_ROOT="$REPO_ROOT/docs/security-audit"
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

EXPLICIT_SESSION=""
RUN_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-id) EXPLICIT_SESSION="${2:?--session-id needs a value}"; shift 2 ;;
    *) RUN_ID="$1"; shift ;;
  esac
done

if [[ -n "$RUN_ID" ]]; then
  STATE_DIR="$AUDITS_ROOT/$RUN_ID/state"
else
  STATE_DIR="$(find "$AUDITS_ROOT" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -n 1 | xargs dirname 2>/dev/null || true)"
fi

if [[ -z "${STATE_DIR:-}" ]] || [[ ! -f "$STATE_DIR/active.yaml" ]]; then
  cat >&2 <<ERR
ERROR: no audit state to resume under $AUDITS_ROOT

If this is a fresh project, run audit-init.sh first to start a new audit.
ERR
  exit 1
fi

get_yaml_field() {
  grep "^$2:" "$1" | head -n 1 | sed "s/^$2: *//; s/^\"\(.*\)\"$/\1/" || true
}

RUN_ID="$(get_yaml_field "$STATE_DIR/active.yaml" run_id)"
STATUS="$(get_yaml_field "$STATE_DIR/active.yaml" status)"
CURRENT_WAVE="$(get_yaml_field "$STATE_DIR/active.yaml" current_wave)"
SESSION="${EXPLICIT_SESSION:-${CLAUDE_CODE_SESSION_ID:-}}"

case "$STATUS" in
  active) ;;  # happy path
  cancelled)
    cat >&2 <<ERR
ERROR: active.yaml.status = cancelled for run $RUN_ID.

Resume will not flip status by itself (it shouldn't — if you cancelled,
that was deliberate). If you want to revive the run, run:
  $SKILL_DIR/scripts/audit-recover.sh uncancel --apply
and then re-run this script.
ERR
    exit 1 ;;
  completed)
    cat >&2 <<ERR
ERROR: active.yaml.status = completed for run $RUN_ID.

Completed audits should not be revived. Start a new run with audit-init.sh.
ERR
    exit 1 ;;
  *)
    echo "ERROR: unexpected active.yaml.status = '$STATUS'" >&2
    exit 1 ;;
esac

# Pending cells quick-count (best-effort; plan.yaml may have varied shapes).
PENDING="$(grep -c '^    status: pending' "$STATE_DIR/plan.yaml" 2>/dev/null || echo 0)"
DONE="$(grep -c '^    status: done' "$STATE_DIR/plan.yaml" 2>/dev/null || echo 0)"
PROGRESS_ITER="$(get_yaml_field "$STATE_DIR/progress.yaml" iteration)"

echo "=== audit-resume ==="
echo "run_id:        $RUN_ID"
echo "state_dir:     $STATE_DIR"
echo "current_wave:  $CURRENT_WAVE"
echo "cells:         $DONE done / $PENDING pending"
echo "iteration:     $PROGRESS_ITER (next will be $((PROGRESS_ITER + 1)))"
echo "session_id:    ${SESSION:-<none — set \$CLAUDE_CODE_SESSION_ID or pass --session-id>}"
echo

if [[ -z "$SESSION" ]]; then
  echo "⚠  No session id available. The loop will still run, but the stop-hook's"
  echo "   session-isolation guard will fall through — meaning ANY Claude session"
  echo "   that stops on this project will drive the audit. Strongly recommended:"
  echo "   pass --session-id <your-id> or export CLAUDE_CODE_SESSION_ID."
  echo
fi

# Delegate the mutating work to audit-recover.sh so there's one writer.
RECOVER="$SKILL_DIR/scripts/audit-recover.sh"
echo "→ $RECOVER reseed-ralph --apply"
bash "$RECOVER" reseed-ralph --apply
if [[ -n "$SESSION" ]]; then
  echo "→ $RECOVER set-session $SESSION --apply"
  bash "$RECOVER" set-session "$SESSION" --apply
fi

cat <<MSG

✅ Audit resumed.

The ralph-loop state has been re-attached to run $RUN_ID at iteration
$PROGRESS_ITER. Your next session-stop will fire iteration $((PROGRESS_ITER + 1))
against the existing plan.yaml — no cells re-dispatched, no findings rewritten.

To check health:   $SKILL_DIR/scripts/audit-doctor.sh
To see status:     $SKILL_DIR/scripts/audit-status.sh
To stop again:     $SKILL_DIR/scripts/audit-cancel.sh
MSG
