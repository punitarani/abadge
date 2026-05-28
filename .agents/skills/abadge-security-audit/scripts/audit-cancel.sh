#!/usr/bin/env bash
# audit-cancel.sh — mark an active audit as cancelled (no deletion).
#
# Usage: audit-cancel.sh [run-id] [--reason "<text>"] [--force]
#   run-id   : optional; defaults to the most-recent active run.
#   --reason : free-form text stored as first-class `cancelled_reason` field.
#   --force  : bypass the session-id guard on ralph-state removal. Without it,
#              the ralph state is only removed if its session_id matches this
#              session (or is empty — legacy fall-through). Same contract the
#              SKILL.md description has always advertised.

set -euo pipefail

REASON=""
RUN_ID=""
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) REASON="${2:-}"; shift 2;;
    --force)  FORCE=1; shift;;
    *)        RUN_ID="$1"; shift;;
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
NOW_EPOCH="$(date +%s)"

# Backup active.yaml before mutation — the awk rewrite is the only in-place
# edit this script does, and a bad rewrite would be unrecoverable otherwise.
cp "$STATE_DIR/active.yaml" "$STATE_DIR/active.yaml.bak.$NOW_EPOCH"

# Portable in-place edit: write temp, move. `cancelled_reason` is a
# top-level first-class field so it's greppable and doesn't corrupt the
# `notes:` multi-line block.
tmp=$(mktemp)
awk -v now="$NOW" -v reason="$REASON" '
  /^status:/         {print "status: cancelled"; seen_status=1; next}
  /^cancelled_at:/   {print "cancelled_at: " now; seen_cat=1; next}
  /^cancelled_reason:/ {next}  # drop any prior value; we re-emit below
  {print}
  END {
    if (!seen_status) print "status: cancelled"
    if (!seen_cat)    print "cancelled_at: " now
    # Always emit reason as top-level field. Empty is fine.
    printf "cancelled_reason: \"%s\"\n", reason
  }
' "$STATE_DIR/active.yaml" > "$tmp"
mv "$tmp" "$STATE_DIR/active.yaml"

# Session-id-checked ralph removal (as SKILL.md has always advertised).
# Only remove the ralph state if either:
#   (a) it belongs to this session (matches $CLAUDE_CODE_SESSION_ID), OR
#   (b) its session_id is empty (legacy fall-through — any session can remove), OR
#   (c) --force was passed.
# This prevents a cancel in one session from killing a live loop in another.
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
RALPH_REMOVED=no
if [[ -f "$RALPH_STATE" ]]; then
  RALPH_SESSION="$(grep '^session_id:' "$RALPH_STATE" | sed 's/session_id: *//' || true)"
  CUR_SESSION="${CLAUDE_CODE_SESSION_ID:-}"
  if [[ $FORCE -eq 1 ]] \
     || [[ -z "$RALPH_SESSION" ]] \
     || [[ "$RALPH_SESSION" == "$CUR_SESSION" ]]; then
    rm "$RALPH_STATE"
    RALPH_REMOVED=yes
    echo "removed $RALPH_STATE"
  else
    echo "WARN: ralph-loop state belongs to session $RALPH_SESSION (not this one)." >&2
    echo "      Cancel from THAT session, or re-run with --force to override." >&2
  fi
fi

# Append to iteration-log so the event is durable.
if [[ -f "$STATE_DIR/iteration-log.md" ]]; then
  echo "iter cancel · $NOW · audit-cancel.sh · ralph_removed=$RALPH_REMOVED · reason=\"$REASON\"" \
    >> "$STATE_DIR/iteration-log.md"
fi

cat <<MSG
Audit marked cancelled.
  state_dir:      $STATE_DIR
  backup:         $STATE_DIR/active.yaml.bak.$NOW_EPOCH
  at:             $NOW
  reason:         ${REASON:-(none)}
  ralph_removed:  $RALPH_REMOVED

Findings and notes retained. To revive this run use audit-recover.sh uncancel --apply;
otherwise start a fresh run with audit-init.sh <new-run-id>.
MSG
