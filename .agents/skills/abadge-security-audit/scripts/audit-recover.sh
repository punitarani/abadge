#!/usr/bin/env bash
# audit-recover.sh — apply targeted fixes so the security-audit loop can resume.
# Default is DRY-RUN. Pass --apply to actually mutate files. Every mutation
# writes a .bak.<epoch> sidecar first.
#
# Subcommands:
#   reseed-ralph [--max N] [--force]
#       Rebuild .claude/ralph-loop.local.md from active.yaml so the
#       stop-hook has something to re-fire. Refuses if the file exists
#       and was written in the last 60 s unless --force.
#
#   bump-max N
#       Increase max_iterations in the ralph state by N (default 80).
#
#   set-session [ID]
#       Set session_id in .claude/ralph-loop.local.md AND active.yaml.
#       Default ID = $CLAUDE_CODE_SESSION_ID. Needed when the stop-hook
#       in your current session is exiting without re-firing.
#
#   uncancel
#       Flip active.yaml status from cancelled back to active. Refuses
#       if status is completed.
#
#   reconcile-counts
#       Scan findings/**/*.md, recompute progress.yaml.findings_by_severity
#       + progress.yaml.integrity.{critical_verified,high_verified} from
#       disk reality, overwrite those fields. Use when counters drift.
#
#   revalidate-findings
#       Walk findings/**/*.md, check each file has a YAML-frontmatter
#       Severity: field matching its parent dir and a file:line cite.
#       Prints per-file diagnoses. Never moves files — just reports.
#
#   all
#       Run reseed-ralph (if missing), set-session, bump-max 80, uncancel
#       (if cancelled), reconcile-counts. Skips revalidate-findings
#       (which only reports).
#
# Usage: audit-recover.sh <subcommand> [args] [--apply]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUDITS_ROOT="$REPO_ROOT/docs/security-audit"
RALPH_STATE="$REPO_ROOT/.claude/ralph-loop.local.md"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NOW_EPOCH="$(date +%s)"

APPLY=0; FORCE=0; POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --force) FORCE=1 ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done
# `${POSITIONAL[@]+"${POSITIONAL[@]}"}` expands safely even when the array is
# empty under `set -u`. Plain `"${POSITIONAL[@]}"` would trip `unbound variable`.
set -- ${POSITIONAL[@]+"${POSITIONAL[@]}"}

SUBCMD="${1:-}"; shift || true
if [[ -z "$SUBCMD" ]]; then
  sed -n '2,40p' "$0"; exit 2
fi

get_yaml_field() {
  local f="$1" k="$2"
  [[ -f "$f" ]] || { echo ""; return; }
  grep "^$k:" "$f" | head -n 1 | sed "s/^$k: *//; s/^\"\(.*\)\"$/\1/" || true
}

discover_state_dir() {
  find "$AUDITS_ROOT" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -n 1 | xargs dirname 2>/dev/null || true
}

require_state_dir() {
  STATE_DIR="$(discover_state_dir)"
  [[ -z "${STATE_DIR:-}" || ! -f "$STATE_DIR/active.yaml" ]] \
    && { echo "ERROR: no audit state dir found under $AUDITS_ROOT" >&2; exit 1; }
  AUDIT_DIR="$(dirname "$STATE_DIR")"
}

replace_field() {
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

# ---------- subcommands ----------
do_reseed_ralph() {
  require_state_dir
  local max="80"
  [[ "${1:-}" == "--max" ]] && max="${2:?--max needs a number}"

  if [[ -f "$RALPH_STATE" ]]; then
    local mtime age
    mtime="$(stat -f %m "$RALPH_STATE" 2>/dev/null || stat -c %Y "$RALPH_STATE" 2>/dev/null || echo 0)"
    age=$(( NOW_EPOCH - mtime ))
    if [[ $age -lt 60 && $FORCE -eq 0 ]]; then
      echo "ERROR: ralph state written ${age}s ago — likely mid-iteration. Pass --force to overwrite." >&2
      exit 1
    fi
  fi

  local run_id progress_iter session skill_root
  run_id="$(get_yaml_field "$STATE_DIR/active.yaml" run_id)"
  progress_iter="$(get_yaml_field "$STATE_DIR/progress.yaml" iteration)"
  [[ "$progress_iter" =~ ^[0-9]+$ ]] || progress_iter=0
  session="${CLAUDE_CODE_SESSION_ID:-}"
  skill_root="$REPO_ROOT/.claude/skills/abadge-security-audit"

  # Ensure iteration-log.md exists — doctor's zombie check depends on it.
  if [[ ! -f "$STATE_DIR/iteration-log.md" ]]; then
    if [[ $APPLY -eq 1 ]]; then
      echo "# Iteration Log — Run $run_id" > "$STATE_DIR/iteration-log.md"
      echo "  created $STATE_DIR/iteration-log.md"
    else
      echo "  DRY-RUN would create $STATE_DIR/iteration-log.md"
    fi
  fi

  echo "reseed-ralph: run_id=$run_id  starting_iter=$progress_iter  max=$max  session=${session:-<none>}"
  local body
  body=$(cat <<YAML
---
active: true
iteration: $progress_iter
session_id: $session
max_iterations: $max
completion_promise: "AUDIT_COMPLETE"
started_at: "$NOW"
---

Run one iteration of the abadge security audit. Read the iteration prompt at $skill_root/scripts/audit-iteration-prompt.md and follow it exactly. All audit memory lives in $STATE_DIR/. The completion promise is AUDIT_COMPLETE — emit it ONLY when every Wave-4 verifier has signed off every Critical and High finding.
YAML
)

  if [[ $APPLY -eq 1 ]]; then
    [[ -f "$RALPH_STATE" ]] && cp "$RALPH_STATE" "$RALPH_STATE.bak.$NOW_EPOCH"
    printf '%s\n' "$body" > "$RALPH_STATE"
    echo "  wrote $RALPH_STATE"
  else
    echo "  DRY-RUN would write $RALPH_STATE"
  fi
}

do_bump_max() {
  [[ -f "$RALPH_STATE" ]] || { echo "ERROR: no ralph state — use reseed-ralph first" >&2; exit 1; }
  local bump="${1:-80}" cur new
  [[ "$bump" =~ ^[0-9]+$ ]] || { echo "ERROR: bump-max needs a positive integer" >&2; exit 2; }
  cur="$(get_yaml_field "$RALPH_STATE" max_iterations)"
  [[ "$cur" =~ ^[0-9]+$ ]] || { echo "ERROR: current max_iterations not numeric ($cur)" >&2; exit 1; }
  new=$(( cur + bump ))
  echo "bump-max: max_iterations $cur → $new"
  replace_field "$RALPH_STATE" max_iterations "$new"
}

do_set_session() {
  local session="${1:-${CLAUDE_CODE_SESSION_ID:-}}"
  [[ -z "$session" ]] && { echo "ERROR: no session id supplied and \$CLAUDE_CODE_SESSION_ID is unset" >&2; exit 2; }
  echo "set-session: $session"
  [[ -f "$RALPH_STATE" ]] && replace_field "$RALPH_STATE" session_id "$session"
  require_state_dir
  replace_field "$STATE_DIR/active.yaml" session_id "$session"
}

do_uncancel() {
  require_state_dir
  local status; status="$(get_yaml_field "$STATE_DIR/active.yaml" status)"
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
    echo "iter uncancel · $NOW · audit-recover.sh uncancel" >> "$STATE_DIR/iteration-log.md"
  fi
}

# Frontmatter-only Verified check. Returns 0 (verified) / 1 (pending).
is_finding_verified() {
  local f="$1" v
  v="$(awk '/^---$/{fm=!fm; next} fm && /^Verified:/ {gsub(/^Verified: */,""); print; exit}' "$f" 2>/dev/null)"
  [[ -n "$v" && "$v" != "pending" && "$v" != "false" && "$v" != "no" ]]
}

do_reconcile_counts() {
  require_state_dir
  local c h m l i cv hv
  c=0; h=0; m=0; l=0; i=0; cv=0; hv=0
  for sev_dir in critical:c high:h medium:m low:l informational:i; do
    local dir="${sev_dir%:*}" var="${sev_dir#*:}"
    local n
    n=$(find "$AUDIT_DIR/findings/$dir" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
    case "$var" in c) c=$n;; h) h=$n;; m) m=$n;; l) l=$n;; i) i=$n;; esac
  done
  while IFS= read -r -d '' f; do is_finding_verified "$f" && cv=$((cv+1)); done \
    < <(find "$AUDIT_DIR/findings/critical" -maxdepth 1 -name '*.md' -print0 2>/dev/null)
  while IFS= read -r -d '' f; do is_finding_verified "$f" && hv=$((hv+1)); done \
    < <(find "$AUDIT_DIR/findings/high" -maxdepth 1 -name '*.md' -print0 2>/dev/null)

  echo "reconcile-counts: disk reality →"
  printf "  findings_by_severity: {critical: %d, high: %d, medium: %d, low: %d, informational: %d}\n" "$c" "$h" "$m" "$l" "$i"
  printf "  integrity: {critical_verified: %d / %d, high_verified: %d / %d}\n" "$cv" "$c" "$hv" "$h"

  local P="$STATE_DIR/progress.yaml"
  local tmp="$P.tmp.$$"
  awk -v c="$c" -v h="$h" -v m="$m" -v l="$l" -v i="$i" -v cv="$cv" -v hv="$hv" '
    /^findings_by_severity:/ {
      printf "findings_by_severity: {critical: %d, high: %d, medium: %d, low: %d, informational: %d}\n", c,h,m,l,i
      next
    }
    /^integrity:/ {print; in_int=1; next}
    in_int && /^  critical_verified:/ {printf "  critical_verified: %d\n", cv; next}
    in_int && /^  high_verified:/     {printf "  high_verified: %d\n",     hv; next}
    in_int && /^[^ ]/ {in_int=0}
    {print}
  ' "$P" > "$tmp"

  if [[ $APPLY -eq 1 ]]; then
    cp "$P" "$P.bak.$NOW_EPOCH"
    mv "$tmp" "$P"
    echo "  wrote $P  (backup: $P.bak.$NOW_EPOCH)"
  else
    echo "  DRY-RUN would rewrite $P"
    rm -f "$tmp"
  fi
}

do_revalidate_findings() {
  require_state_dir
  local bad=0
  echo "revalidate-findings: checking finding file integrity..."
  for sev in critical high medium low informational; do
    while IFS= read -r -d '' f; do
      local sev_in_file
      sev_in_file="$(awk '/^---$/{fm=!fm; next} fm && /^Severity:/ {gsub(/^Severity: */,""); print; exit}' "$f" 2>/dev/null | tr '[:upper:]' '[:lower:]')"
      local has_cite; has_cite="$(grep -cE '(^|[^A-Za-z])[A-Za-z/_.-]+\.(ts|tsx|js|sh|md|yaml|toml):[0-9]+' "$f" 2>/dev/null || echo 0)"
      if [[ -z "$sev_in_file" ]]; then
        echo "  [MISSING-SEVERITY] $f"; bad=$((bad+1))
      elif [[ "$sev_in_file" != "$sev" ]]; then
        echo "  [SEVERITY-MISMATCH] $f (dir=$sev, frontmatter=$sev_in_file)"; bad=$((bad+1))
      fi
      if [[ "$has_cite" -eq 0 ]]; then
        echo "  [NO-FILE-LINE-CITE] $f"; bad=$((bad+1))
      fi
    done < <(find "$AUDIT_DIR/findings/$sev" -maxdepth 1 -name '*.md' -print0 2>/dev/null)
  done
  if [[ $bad -eq 0 ]]; then
    echo "  OK — all findings have Severity frontmatter matching dir and at least one file:line citation"
  else
    echo "  $bad integrity issue(s). No files moved; fix manually or re-dispatch the originating subagent."
  fi
}

do_all() {
  echo "--- reseed-ralph if missing ---"
  if [[ ! -f "$RALPH_STATE" ]]; then do_reseed_ralph; else echo "  ralph state present, skipping"; fi
  echo "--- set-session ---"
  do_set_session "${CLAUDE_CODE_SESSION_ID:-}" || true
  echo "--- bump-max 80 ---"
  do_bump_max 80 || true
  echo "--- uncancel if cancelled ---"
  require_state_dir
  local status; status="$(get_yaml_field "$STATE_DIR/active.yaml" status)"
  if [[ "$status" == "cancelled" ]]; then do_uncancel; else echo "  status=$status, skipping"; fi
  echo "--- reconcile-counts ---"
  do_reconcile_counts
}

case "$SUBCMD" in
  reseed-ralph)        do_reseed_ralph "$@" ;;
  bump-max)            do_bump_max "$@" ;;
  set-session)         do_set_session "$@" ;;
  uncancel)            do_uncancel ;;
  reconcile-counts)    do_reconcile_counts ;;
  revalidate-findings) do_revalidate_findings ;;
  all)                 do_all ;;
  *) echo "ERROR: unknown subcommand: $SUBCMD" >&2; sed -n '2,40p' "$0"; exit 2 ;;
esac

if [[ $APPLY -eq 0 ]]; then
  echo
  echo "(DRY-RUN — re-run with --apply to actually make these changes)"
fi
