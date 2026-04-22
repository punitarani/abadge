#!/usr/bin/env bash
# sweep-recover.sh — apply targeted fixes so the sweep loop can resume.
# Default is DRY-RUN. Pass --apply to actually mutate files. Every mutation
# writes a .bak.<epoch> sidecar first.
#
# Subcommands:
#   reseed-ralph [--max N] [--force]
#       Rebuild .claude/ralph-loop.local.md from active.yaml so the
#       stop-hook has something to re-fire. Refuses if the file exists
#       and was written in the last 60s unless --force (avoids racing
#       the live stop-hook mid-iteration).
#
#   bump-max N
#       Increase max_iterations in the ralph state by N (default 100).
#
#   set-session [ID]
#       Set session_id in .claude/ralph-loop.local.md AND active.yaml.
#       Default ID = $CLAUDE_CODE_SESSION_ID. Needed when the stop-hook
#       in your current session is exiting without re-firing.
#
#   uncancel
#       Flip active.yaml status from cancelled back to active. Requires
#       --apply; will not run if status is already active or completed.
#
#   all
#       Run reseed-ralph (if missing), set-session, bump-max 100, uncancel
#       (if cancelled). Each only if its precondition applies.
#
# Usage: sweep-recover.sh <subcommand> [args] [--apply]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SWEEPS_DIR="$REPO_ROOT/docs/superpowers/sweeps"
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NOW_EPOCH="$(date +%s)"

# ---------- flag parsing ----------
APPLY=0
FORCE=0
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --force) FORCE=1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
set -- "${POSITIONAL[@]}"

SUBCMD="${1:-}"
shift || true

if [[ -z "$SUBCMD" ]]; then
  sed -n '2,30p' "$0"; exit 2
fi

# ---------- shared helpers ----------
backup_then_write() {
  # usage: backup_then_write <path> <new-content-via-stdin>
  local path="$1" tmp="$1.tmp.$$"
  cat > "$tmp"
  if [[ $APPLY -eq 1 ]]; then
    [[ -f "$path" ]] && cp "$path" "$path.bak.$NOW_EPOCH"
    mv "$tmp" "$path"
    echo "  wrote $path  (backup: $path.bak.$NOW_EPOCH)"
  else
    echo "  DRY-RUN would rewrite $path (diff preview below):"
    diff -u "$path" "$tmp" 2>/dev/null | sed 's/^/    /' | head -n 30 || true
    rm -f "$tmp"
  fi
}

replace_field() {
  # usage: replace_field <path> <key> <value>
  local path="$1" key="$2" val="$3" tmp="$1.tmp.$$"
  if grep -q "^$key:" "$path"; then
    sed "s|^$key:.*|$key: $val|" "$path" > "$tmp"
  else
    { cat "$path"; echo "$key: $val"; } > "$tmp"
  fi
  if [[ $APPLY -eq 1 ]]; then
    cp "$path" "$path.bak.$NOW_EPOCH"
    mv "$tmp" "$path"
    echo "  set $key=$val in $path  (backup: $path.bak.$NOW_EPOCH)"
  else
    echo "  DRY-RUN would set $key=$val in $path"
    rm -f "$tmp"
  fi
}

discover_state_dir() {
  find "$SWEEPS_DIR" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -n 1 | xargs dirname 2>/dev/null || true
}

get_yaml_field() {
  local f="$1" k="$2"
  [[ -f "$f" ]] || { echo ""; return; }
  grep "^$k:" "$f" | head -n 1 | sed "s/^$k: *//; s/^\"\(.*\)\"$/\1/" || true
}

require_state_dir() {
  STATE_DIR="$(discover_state_dir)"
  [[ -z "$STATE_DIR" || ! -f "$STATE_DIR/active.yaml" ]] \
    && { echo "ERROR: no sweep state dir found under $SWEEPS_DIR" >&2; exit 1; }
}

# ---------- subcommands ----------
do_reseed_ralph() {
  require_state_dir
  local max="100"
  [[ "${1:-}" == "--max" ]] && max="${2:?--max needs a number}"

  if [[ -f "$RALPH_STATE" ]]; then
    local mtime age
    mtime="$(stat -f %m "$RALPH_STATE" 2>/dev/null || stat -c %Y "$RALPH_STATE" 2>/dev/null || echo 0)"
    age=$(( NOW_EPOCH - mtime ))
    if [[ $age -lt 60 && $FORCE -eq 0 ]]; then
      echo "ERROR: ralph state written ${age}s ago — likely mid-iteration. Pass --force to overwrite anyway." >&2
      exit 1
    fi
  fi

  local run_id="$(get_yaml_field "$STATE_DIR/active.yaml" run_id)"
  local progress_iter="$(get_yaml_field "$STATE_DIR/progress.yaml" iteration)"
  [[ "$progress_iter" =~ ^[0-9]+$ ]] || progress_iter=0
  local session="${CLAUDE_CODE_SESSION_ID:-}"

  echo "reseed-ralph: run_id=$run_id  starting_iter=$progress_iter  max=$max  session=${session:-<none>}"
  backup_then_write "$RALPH_STATE" <<YAML
---
active: true
iteration: $progress_iter
session_id: $session
max_iterations: $max
completion_promise: "SWEEP_COMPLETE"
started_at: "$NOW"
---

Run the abadge E2E sweep per the iteration prompt at $REPO_ROOT/.claude/skills/abadge-e2e-sweep/scripts/sweep-iteration-prompt.md. Read that file at the start of every iteration and follow its steps exactly. All sweep memory lives in $STATE_DIR/. The completion promise is SWEEP_COMPLETE.
YAML
}

do_bump_max() {
  [[ -f "$RALPH_STATE" ]] || { echo "ERROR: no ralph state at $RALPH_STATE — use reseed-ralph first" >&2; exit 1; }
  local bump="${1:-100}"
  [[ "$bump" =~ ^[0-9]+$ ]] || { echo "ERROR: bump-max needs a positive integer" >&2; exit 2; }
  local cur new
  cur="$(get_yaml_field "$RALPH_STATE" max_iterations)"
  [[ "$cur" =~ ^[0-9]+$ ]] || { echo "ERROR: current max_iterations not numeric ($cur)" >&2; exit 1; }
  new=$(( cur + bump ))
  echo "bump-max: max_iterations $cur → $new"
  replace_field "$RALPH_STATE" max_iterations "$new"
}

do_set_session() {
  local session="${1:-${CLAUDE_CODE_SESSION_ID:-}}"
  if [[ -z "$session" ]]; then
    echo "ERROR: no session id supplied and \$CLAUDE_CODE_SESSION_ID is unset" >&2
    exit 2
  fi
  echo "set-session: $session"
  [[ -f "$RALPH_STATE" ]] && replace_field "$RALPH_STATE" session_id "$session"
  require_state_dir
  replace_field "$STATE_DIR/active.yaml" session_id "$session"
}

do_uncancel() {
  require_state_dir
  local status="$(get_yaml_field "$STATE_DIR/active.yaml" status)"
  case "$status" in
    cancelled) ;;
    active)    echo "already active; nothing to do"; return 0 ;;
    completed) echo "ERROR: status=completed — do not revive; start a new run" >&2; exit 1 ;;
    *)         echo "ERROR: unexpected status=$status" >&2; exit 1 ;;
  esac
  echo "uncancel: status cancelled → active"
  replace_field "$STATE_DIR/active.yaml" status active
  replace_field "$STATE_DIR/active.yaml" cancelled_at null
  if [[ $APPLY -eq 1 ]]; then
    echo "iter uncancel · $NOW · sweep-recover.sh uncancel" >> "$STATE_DIR/iteration-log.md"
  fi
}

do_all() {
  echo "--- reseed-ralph if missing ---"
  if [[ ! -f "$RALPH_STATE" ]]; then do_reseed_ralph; else echo "  ralph state present, skipping"; fi
  echo "--- set-session ---"
  do_set_session "${CLAUDE_CODE_SESSION_ID:-}" || true
  echo "--- bump-max 100 ---"
  do_bump_max 100 || true
  echo "--- uncancel if cancelled ---"
  require_state_dir
  local status="$(get_yaml_field "$STATE_DIR/active.yaml" status)"
  if [[ "$status" == "cancelled" ]]; then do_uncancel; else echo "  status=$status, skipping"; fi
}

# ---------- dispatch ----------
case "$SUBCMD" in
  reseed-ralph) do_reseed_ralph "$@" ;;
  bump-max)     do_bump_max "$@" ;;
  set-session)  do_set_session "$@" ;;
  uncancel)     do_uncancel ;;
  all)          do_all ;;
  *) echo "ERROR: unknown subcommand: $SUBCMD" >&2; sed -n '2,30p' "$0"; exit 2 ;;
esac

if [[ $APPLY -eq 0 ]]; then
  echo
  echo "(DRY-RUN — re-run with --apply to actually make these changes)"
fi
