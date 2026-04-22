#!/usr/bin/env bash
# audit-doctor.sh — diagnose why the security-audit loop looks stuck.
# READ-ONLY. Prints problems, their cause, and the exact recover command to run.
#
# Usage: audit-doctor.sh [run-id]
#   run-id : optional; defaults to the most-recent run with an active.yaml

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUDITS_ROOT="$REPO_ROOT/docs/security-audit"
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
NOW_EPOCH="$(date +%s)"

if [[ -n "${1:-}" ]]; then
  STATE_DIR="$AUDITS_ROOT/$1/state"
else
  STATE_DIR="$(find "$AUDITS_ROOT" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -n 1 | xargs dirname 2>/dev/null || true)"
fi

PROBLEMS=(); WARNINGS=(); INFO=()
add_problem() { PROBLEMS+=("$1"); }
add_warning() { WARNINGS+=("$1"); }
add_info()    { INFO+=("$1"); }

get_yaml_field() {
  local f="$1" k="$2"
  [[ -f "$f" ]] || { echo ""; return; }
  grep "^$k:" "$f" | head -n 1 | sed "s/^$k: *//; s/^\"\(.*\)\"$/\1/" || true
}

# ---------- audit state ----------
if [[ -z "${STATE_DIR:-}" ]] || [[ ! -f "$STATE_DIR/active.yaml" ]]; then
  add_problem "No audit state dir discoverable under $AUDITS_ROOT (run from the correct worktree, or pass a run-id)"
  STATE_DIR=""
else
  AUDIT_DIR="$(dirname "$STATE_DIR")"
  add_info "state_dir = $STATE_DIR"
  RUN_ID="$(get_yaml_field "$STATE_DIR/active.yaml" run_id)"
  AUDIT_STATUS="$(get_yaml_field "$STATE_DIR/active.yaml" status)"
  AUDIT_SESSION="$(get_yaml_field "$STATE_DIR/active.yaml" session_id)"
  CURRENT_WAVE="$(get_yaml_field "$STATE_DIR/active.yaml" current_wave)"
  add_info "run_id       = $RUN_ID"
  add_info "status       = $AUDIT_STATUS    current_wave = $CURRENT_WAVE"

  [[ "$AUDIT_STATUS" == "cancelled" ]] && add_problem "active.yaml status=cancelled — /resume and the loop won't pick this up until status is flipped back (FIX: audit-recover.sh uncancel --apply)"
  [[ "$AUDIT_STATUS" == "completed" ]] && add_warning "active.yaml status=completed — don't revive; start a new run"
  [[ -z "$AUDIT_SESSION" || "$AUDIT_SESSION" == "unknown" ]] && add_warning "active.yaml session_id=\"$AUDIT_SESSION\" — cancel/recover safety guards degrade to any-session-wins (FIX: audit-recover.sh set-session --apply)"
fi

# ---------- ralph-loop state ----------
if [[ ! -f "$RALPH_STATE" ]]; then
  if [[ -n "${STATE_DIR:-}" && "$AUDIT_STATUS" == "active" ]]; then
    add_problem "ralph-loop state missing at $RALPH_STATE but audit is marked active — loop driver is gone; nothing will re-fire"
    add_problem "  FIX:  audit-recover.sh reseed-ralph --apply"
  else
    add_info "ralph-loop state absent (expected if audit is cancelled/done/unstarted)"
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

  if ! [[ "$RALPH_ITER" =~ ^[0-9]+$ ]]; then
    add_problem "ralph iteration field not numeric (got: \"$RALPH_ITER\") — stop hook will rm the file"
    add_problem "  FIX:  audit-recover.sh reseed-ralph --apply"
  fi
  if ! [[ "$RALPH_MAX" =~ ^[0-9]+$ ]]; then
    add_problem "ralph max_iterations not numeric (got: \"$RALPH_MAX\")"
    add_problem "  FIX:  audit-recover.sh reseed-ralph --apply"
  fi

  if [[ "$RALPH_ITER" =~ ^[0-9]+$ ]] && [[ "$RALPH_MAX" =~ ^[0-9]+$ ]] && [[ "$RALPH_MAX" -gt 0 ]]; then
    REMAINING=$(( RALPH_MAX - RALPH_ITER ))
    if [[ $REMAINING -le 0 ]]; then
      add_problem "ralph iteration ($RALPH_ITER) hit max_iterations ($RALPH_MAX) — next stop hook terminates the loop"
      add_problem "  FIX:  audit-recover.sh bump-max 80 --apply"
    elif [[ $REMAINING -le 5 ]]; then
      add_warning "only $REMAINING iterations left before max_iterations — bump now to avoid a surprise stop"
    fi
  fi

  CUR_SESSION="${CLAUDE_CODE_SESSION_ID:-}"
  if [[ -z "$RALPH_SESSION" ]]; then
    add_warning "ralph session_id is empty — legacy fallthrough in stop-hook means any session drives the loop"
  elif [[ -n "$CUR_SESSION" ]] && [[ "$RALPH_SESSION" != "$CUR_SESSION" ]]; then
    add_problem "ralph session_id=$RALPH_SESSION but current session=$CUR_SESSION — stop hook in THIS session will exit without re-firing"
    add_problem "  FIX:  audit-recover.sh set-session --apply    (takes ownership in this session)"
  fi

  if [[ $RALPH_AGE_SEC -gt 1800 ]]; then
    add_warning "ralph state unwritten for $(( RALPH_AGE_SEC / 60 )) minutes — either between long iters or the loop stopped uncleanly"
  fi

  # Zombie driver: ralph fresh but iteration-log frozen — hook advancing counter
  # without any iteration body executing (hijacked by an unrelated session).
  if [[ -n "${STATE_DIR:-}" ]] && [[ -f "$STATE_DIR/iteration-log.md" ]]; then
    LOG_MTIME="$(stat -f %m "$STATE_DIR/iteration-log.md" 2>/dev/null || stat -c %Y "$STATE_DIR/iteration-log.md" 2>/dev/null || echo 0)"
    LOG_AGE_SEC=$(( NOW_EPOCH - LOG_MTIME ))
    if [[ $RALPH_AGE_SEC -lt 300 ]] && [[ $LOG_AGE_SEC -gt 900 ]]; then
      add_problem "zombie driver: ralph state updated ${RALPH_AGE_SEC}s ago but iteration-log.md hasn't changed in $(( LOG_AGE_SEC / 60 )) min — a stop-hook is advancing the counter but no iteration body is running (controller session is likely dead)"
      add_problem "  FIX:  rm \"$RALPH_STATE\"    (breaks the hijack; audit data is preserved)"
      add_problem "  THEN: audit-resume.sh    (re-attaches to this run from the controller session)"
    fi
  elif [[ -n "${STATE_DIR:-}" ]]; then
    add_warning "iteration-log.md missing at $STATE_DIR — zombie detection disabled; expected since pre-fix audit-init.sh didn't create it (FIX: audit-recover.sh reseed-ralph --apply rebuilds it)"
  fi
fi

# ---------- iteration prompt path ----------
if [[ -f "$RALPH_STATE" ]]; then
  REFERENCED_PROMPT="$(grep -oE '/[^ ]*audit-iteration-prompt\.md' "$RALPH_STATE" | head -n 1 || true)"
  if [[ -n "$REFERENCED_PROMPT" ]]; then
    if [[ -f "$REFERENCED_PROMPT" ]]; then
      add_info "iteration prompt referenced: $REFERENCED_PROMPT (exists)"
    else
      add_problem "ralph prompt references $REFERENCED_PROMPT but that file is missing — loop has nothing to re-fire"
      add_problem "  FIX:  audit-recover.sh reseed-ralph --apply"
    fi
  else
    add_warning "ralph state has no iteration-prompt reference in its body — may be corrupt"
  fi
fi

# ---------- audit-specific integrity checks ----------
if [[ -n "${STATE_DIR:-}" && -n "${AUDIT_DIR:-}" ]] && [[ -d "$AUDIT_DIR/findings" ]]; then
  # Finding-count drift: filesystem vs progress.yaml counters
  for sev in critical high medium low informational; do
    DISK_N=$(find "$AUDIT_DIR/findings/$sev" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    CTR_N="$(awk -v k="$sev" '
      /^findings_by_severity:/      {in_block=1; next}
      in_block && /^ *[a-z]+:/      {gsub(":","",$1); gsub(",","",$2); if ($1==k) {print $2; exit}}
      in_block && /^[^ ]/           {exit}
    ' "$STATE_DIR/progress.yaml" 2>/dev/null)"
    CTR_N="${CTR_N:-0}"
    if [[ "$DISK_N" -ne "$CTR_N" ]]; then
      add_problem "finding count drift in $sev/: filesystem has $DISK_N files, progress.yaml.findings_by_severity.$sev=$CTR_N"
      add_problem "  FIX:  audit-recover.sh reconcile-counts --apply"
    fi
  done

  # Unverified Critical/High — blocks AUDIT_COMPLETE honestly
  UNVERIFIED_C=()
  UNVERIFIED_H=()
  for sev_dir in critical high; do
    while IFS= read -r -d '' f; do
      # Check for Verified: inside YAML frontmatter only (first --- fence to second ---).
      is_verified="$(awk '/^---$/{f=!f; next} f && /^Verified:/ {gsub(/^Verified: */,""); print; exit}' "$f" 2>/dev/null)"
      if [[ -z "$is_verified" ]] || [[ "$is_verified" == "pending" ]] || [[ "$is_verified" == "false" ]]; then
        id="$(basename "$f" .md)"
        if [[ "$sev_dir" == "critical" ]]; then UNVERIFIED_C+=("$id"); else UNVERIFIED_H+=("$id"); fi
      fi
    done < <(find "$AUDIT_DIR/findings/$sev_dir" -maxdepth 1 -name '*.md' -print0 2>/dev/null)
  done
  if [[ ${#UNVERIFIED_C[@]} -gt 0 ]] || [[ ${#UNVERIFIED_H[@]} -gt 0 ]]; then
    add_info "unverified Critical: ${#UNVERIFIED_C[@]}  unverified High: ${#UNVERIFIED_H[@]}"
    if [[ ${#UNVERIFIED_C[@]} -le 10 && ${#UNVERIFIED_C[@]} -gt 0 ]]; then
      add_info "  Critical ids: ${UNVERIFIED_C[*]}"
    fi
    if [[ ${#UNVERIFIED_H[@]} -le 10 && ${#UNVERIFIED_H[@]} -gt 0 ]]; then
      add_info "  High ids:     ${UNVERIFIED_H[*]}"
    fi
  fi

  # Finding frontmatter integrity: Severity in frontmatter matches directory
  BAD_FRONTMATTER=()
  for sev_dir in critical high medium low informational; do
    while IFS= read -r -d '' f; do
      sev_in_file="$(awk '/^---$/{f=!f; next} f && /^Severity:/ {gsub(/^Severity: */,""); print; exit}' "$f" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
      if [[ -z "$sev_in_file" ]] || [[ "$sev_in_file" != "$sev_dir" ]]; then
        BAD_FRONTMATTER+=("$(basename "$f") (dir=$sev_dir, frontmatter=$sev_in_file)")
      fi
    done < <(find "$AUDIT_DIR/findings/$sev_dir" -maxdepth 1 -name '*.md' -print0 2>/dev/null)
  done
  if [[ ${#BAD_FRONTMATTER[@]} -gt 0 ]]; then
    add_warning "${#BAD_FRONTMATTER[@]} finding file(s) have Severity frontmatter missing or mismatched with parent dir"
    add_warning "  FIX:  audit-recover.sh revalidate-findings --apply    (prints per-file diagnoses)"
  fi

  # Wave gate consistency: cells with status=done in prior waves implied by current_wave value
  if [[ -f "$STATE_DIR/plan.yaml" ]]; then
    for w in 1 2 3; do
      if [[ "${CURRENT_WAVE:-1}" -gt "$w" ]]; then
        PENDING_IN_PRIOR=$(awk -v w="$w" '
          /^  - id:/      {cell=1; wave=""; status=""; next}
          cell && /^    wave:/   {wave=$2; next}
          cell && /^    status:/ {status=$2; next}
          cell && /^  - id:/     {if (wave==w && status=="pending") c++; cell=1; wave=""; status=""; next}
          END {if (wave==w && status=="pending") c++; print c+0}
        ' "$STATE_DIR/plan.yaml")
        if [[ "$PENDING_IN_PRIOR" -gt 0 ]]; then
          add_warning "current_wave=$CURRENT_WAVE but wave $w has $PENDING_IN_PRIOR cells still pending — wave gate may have been skipped"
        fi
      fi
    done
  fi
fi

# ---------- report ----------
echo "=== Audit Doctor ==="
printf '%s\n' "${INFO[@]/#/[info] }"
[[ ${#WARNINGS[@]} -gt 0 ]] && { echo; printf '%s\n' "${WARNINGS[@]/#/[warn] }"; }
[[ ${#PROBLEMS[@]} -gt 0 ]] && { echo; printf '%s\n' "${PROBLEMS[@]/#/[PROB] }"; }
echo
if [[ ${#PROBLEMS[@]} -eq 0 ]]; then
  echo "✅ No blockers detected."
  exit 0
else
  echo "❌ ${#PROBLEMS[@]} blocker(s). Run the suggested audit-recover.sh commands, then audit-status.sh to confirm."
  exit 1
fi
