#!/usr/bin/env bash
# sweep-doctor.sh — diagnose why the sweep or its ralph-loop driver looks stuck.
# READ-ONLY. Prints problems, their cause, and the exact recover command to run.
#
# Usage: sweep-doctor.sh [run-id]
#   run-id : optional; defaults to the most-recent run with an active.yaml

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SWEEPS_DIR="$REPO_ROOT/docs/superpowers/sweeps"
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
NOW_EPOCH="$(date +%s)"

if [[ -n "${1:-}" ]]; then
  STATE_DIR="$SWEEPS_DIR/$1/state"
else
  STATE_DIR="$(find "$SWEEPS_DIR" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -n 1 | xargs dirname 2>/dev/null || true)"
fi

# ---------- diagnostic collectors ----------
PROBLEMS=()
WARNINGS=()
INFO=()

add_problem() { PROBLEMS+=("$1"); }
add_warning() { WARNINGS+=("$1"); }
add_info()    { INFO+=("$1"); }

get_yaml_field() {
  # usage: get_yaml_field <file> <key>  → value or empty
  local f="$1" k="$2"
  [[ -f "$f" ]] || { echo ""; return; }
  grep "^$k:" "$f" | head -n 1 | sed "s/^$k: *//; s/^\"\(.*\)\"$/\1/" || true
}

# ---------- sweep state checks ----------
if [[ -z "${STATE_DIR:-}" ]] || [[ ! -f "$STATE_DIR/active.yaml" ]]; then
  add_problem "No sweep state dir discoverable under $SWEEPS_DIR (run from inside the correct worktree, or pass a run-id)"
  STATE_DIR=""
else
  add_info "state_dir = $STATE_DIR"
  RUN_ID="$(get_yaml_field "$STATE_DIR/active.yaml" run_id)"
  SWEEP_STATUS="$(get_yaml_field "$STATE_DIR/active.yaml" status)"
  SWEEP_SESSION="$(get_yaml_field "$STATE_DIR/active.yaml" session_id)"
  SWEEP_CANCELLED="$(get_yaml_field "$STATE_DIR/active.yaml" cancelled_at)"
  SWEEP_COMPLETED="$(get_yaml_field "$STATE_DIR/active.yaml" completed_at)"
  add_info "run_id   = $RUN_ID"
  add_info "status   = $SWEEP_STATUS"

  [[ "$SWEEP_STATUS" == "cancelled" ]] && add_problem "active.yaml status=cancelled (cancelled_at=$SWEEP_CANCELLED) — /resume and the loop won't pick this up until status is flipped back"
  [[ "$SWEEP_STATUS" == "completed" ]] && add_warning "active.yaml status=completed (completed_at=$SWEEP_COMPLETED) — you probably don't want to revive this; start a new run"
  [[ -z "$SWEEP_SESSION" || "$SWEEP_SESSION" == "unknown" ]] && add_warning "active.yaml session_id=\"$SWEEP_SESSION\" — cancel/recover safety guards degrade to any-session-wins"

  if [[ -f "$STATE_DIR/progress.yaml" ]]; then
    PROGRESS_ITER="$(get_yaml_field "$STATE_DIR/progress.yaml" iteration)"
    add_info "progress.yaml iteration = $PROGRESS_ITER"
  fi
fi

# ---------- ralph-loop state checks ----------
if [[ ! -f "$RALPH_STATE" ]]; then
  if [[ -n "$STATE_DIR" && "$SWEEP_STATUS" == "active" ]]; then
    add_problem "ralph-loop state missing at $RALPH_STATE — sweep is marked active but the loop driver is gone; nothing will re-fire"
    add_problem "  FIX:  sweep-recover.sh reseed-ralph --apply"
  else
    add_info "ralph-loop state absent (expected if sweep is cancelled/done)"
  fi
else
  RALPH_MTIME="$(stat -f %m "$RALPH_STATE" 2>/dev/null || stat -c %Y "$RALPH_STATE" 2>/dev/null || echo 0)"
  RALPH_AGE_SEC=$(( NOW_EPOCH - RALPH_MTIME ))
  RALPH_ITER="$(get_yaml_field "$RALPH_STATE" iteration)"
  RALPH_MAX="$(get_yaml_field "$RALPH_STATE" max_iterations)"
  RALPH_SESSION="$(get_yaml_field "$RALPH_STATE" session_id)"
  RALPH_PROMISE="$(get_yaml_field "$RALPH_STATE" completion_promise)"
  add_info "ralph iteration = $RALPH_ITER / $RALPH_MAX    (last write: ${RALPH_AGE_SEC}s ago)"
  add_info "ralph session_id = \"$RALPH_SESSION\"     completion_promise = \"$RALPH_PROMISE\""

  # numeric sanity
  if ! [[ "$RALPH_ITER" =~ ^[0-9]+$ ]]; then
    add_problem "ralph state iteration field not numeric (got: \"$RALPH_ITER\") — stop hook will rm the file and abort"
    add_problem "  FIX:  sweep-recover.sh reseed-ralph --apply"
  fi
  if ! [[ "$RALPH_MAX" =~ ^[0-9]+$ ]]; then
    add_problem "ralph state max_iterations field not numeric (got: \"$RALPH_MAX\")"
    add_problem "  FIX:  sweep-recover.sh reseed-ralph --apply"
  fi

  # budget exhaustion
  if [[ "$RALPH_ITER" =~ ^[0-9]+$ ]] && [[ "$RALPH_MAX" =~ ^[0-9]+$ ]] && [[ "$RALPH_MAX" -gt 0 ]]; then
    REMAINING=$(( RALPH_MAX - RALPH_ITER ))
    if [[ $REMAINING -le 0 ]]; then
      add_problem "ralph iteration ($RALPH_ITER) has hit max_iterations ($RALPH_MAX) — next stop hook will terminate the loop"
      add_problem "  FIX:  sweep-recover.sh bump-max 100 --apply"
    elif [[ $REMAINING -le 5 ]]; then
      add_warning "only $REMAINING iterations left before max_iterations; bump now to avoid a surprise stop"
    fi
  fi

  # session isolation
  CUR_SESSION="${CLAUDE_CODE_SESSION_ID:-}"
  if [[ -z "$RALPH_SESSION" ]]; then
    add_warning "ralph session_id is empty — legacy fallthrough in stop-hook means any session drives the loop"
  elif [[ -n "$CUR_SESSION" ]] && [[ "$RALPH_SESSION" != "$CUR_SESSION" ]]; then
    add_problem "ralph session_id=$RALPH_SESSION but current session=$CUR_SESSION — stop hook in THIS session will exit without re-firing"
    add_problem "  FIX:  sweep-recover.sh set-session --apply       (takes ownership in this session)"
  fi

  # drift between ralph and sweep
  if [[ -n "${STATE_DIR:-}" ]] && [[ -n "${PROGRESS_ITER:-}" ]] && [[ "$RALPH_ITER" =~ ^[0-9]+$ ]] && [[ "$PROGRESS_ITER" =~ ^[0-9]+$ ]]; then
    DRIFT=$(( RALPH_ITER - PROGRESS_ITER ))
    if [[ $DRIFT -gt 2 ]]; then
      add_warning "ralph iteration ($RALPH_ITER) is $DRIFT ahead of progress.yaml ($PROGRESS_ITER) — iterations started but never wrote progress; a prior iteration may have crashed"
    elif [[ $DRIFT -lt 0 ]]; then
      add_warning "progress.yaml iteration ($PROGRESS_ITER) is AHEAD of ralph ($RALPH_ITER) — state files disagree"
    fi
  fi

  # staleness: no activity in > 30 min while status=active is suspicious
  if [[ $RALPH_AGE_SEC -gt 1800 ]]; then
    add_warning "ralph state unwritten for $(( RALPH_AGE_SEC / 60 )) minutes — either the loop is between long iters, or it's stopped without cleaning up"
  fi

  # zombie driver: ralph mtime is FRESH but iteration-log.md is STALE, meaning
  # some session's stop-hook is bumping the counter without any iteration body
  # actually executing. This is the "hijacked-by-another-session" signature.
  if [[ -n "${STATE_DIR:-}" ]] && [[ -f "$STATE_DIR/iteration-log.md" ]]; then
    LOG_MTIME="$(stat -f %m "$STATE_DIR/iteration-log.md" 2>/dev/null || stat -c %Y "$STATE_DIR/iteration-log.md" 2>/dev/null || echo 0)"
    LOG_AGE_SEC=$(( NOW_EPOCH - LOG_MTIME ))
    # If ralph was written within 5 min but iteration-log hasn't changed in
    # 3x that, the hook is firing into a session that isn't doing the work.
    if [[ $RALPH_AGE_SEC -lt 300 ]] && [[ $LOG_AGE_SEC -gt 900 ]]; then
      add_problem "zombie driver: ralph state updated ${RALPH_AGE_SEC}s ago but iteration-log.md hasn't changed in $(( LOG_AGE_SEC / 60 )) min — a stop-hook is advancing the counter but no iteration body is running (controller session is likely dead)"
      add_problem "  FIX:  rm \"$RALPH_STATE\"    (breaks the hijack; sweep data is preserved)"
      add_problem "  THEN: open a Claude session in the worktree and run /abadge-e2e-sweep resume"
    fi
  fi
fi

# ---------- iteration prompt path (the hook reads this every iter) ----------
# The ralph state embeds an absolute path to sweep-iteration-prompt.md in its
# prompt body. Extract it and check the actual path the live loop will read,
# not a worktree-relative guess.
if [[ -f "$RALPH_STATE" ]]; then
  REFERENCED_PROMPT="$(grep -oE '/[^ ]*sweep-iteration-prompt\.md' "$RALPH_STATE" | head -n 1 || true)"
  if [[ -n "$REFERENCED_PROMPT" ]]; then
    if [[ -f "$REFERENCED_PROMPT" ]]; then
      add_info "iteration prompt referenced: $REFERENCED_PROMPT (exists)"
    else
      add_problem "ralph prompt references $REFERENCED_PROMPT but that file is missing — loop has nothing to re-fire"
      add_problem "  FIX:  sweep-recover.sh reseed-ralph --apply    (rewrites path to current skill copy)"
    fi
  else
    add_warning "ralph state has no iteration-prompt reference in its body — may be corrupt"
  fi
fi

# ---------- dev-stack probes (non-fatal; sweep blocks without them) ----------
for url in "http://localhost:8787/health" "http://localhost:8788/health" "http://localhost:3000/"; do
  if curl -s -f -m 2 -o /dev/null "$url"; then
    add_info "dev-stack probe: $url → reachable"
  else
    add_info "dev-stack probe: $url → unreachable"
  fi
done

# ---------- report ----------
echo "=== Sweep Doctor ==="
printf '%s\n' "${INFO[@]/#/[info] }"
[[ ${#WARNINGS[@]} -gt 0 ]] && { echo; printf '%s\n' "${WARNINGS[@]/#/[warn] }"; }
[[ ${#PROBLEMS[@]} -gt 0 ]] && { echo; printf '%s\n' "${PROBLEMS[@]/#/[PROB] }"; }

echo
if [[ ${#PROBLEMS[@]} -eq 0 ]]; then
  echo "✅ No blockers detected. The loop should be self-driving."
  exit 0
else
  echo "❌ ${#PROBLEMS[@]} blocker(s). Run the suggested sweep-recover.sh commands, then sweep-status.sh to confirm."
  exit 1
fi
