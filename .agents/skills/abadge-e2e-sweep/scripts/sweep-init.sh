#!/usr/bin/env bash
# sweep-init.sh — initialise sweep state directory and seed plan.yaml
#
# Usage: sweep-init.sh <surfaces> <mode> [run-id] [--session-id <id>]
#   surfaces      : comma-separated list, "all" for everything
#   mode          : bfs | dfs | hybrid
#   run-id        : optional; auto-generated if omitted
#   --session-id  : controller session id. Written into active.yaml so the
#                   stop-hook's session-isolation guard works. Falls back to
#                   $CLAUDE_CODE_SESSION_ID if unset, then "unknown". Passing
#                   it explicitly is strongly recommended — empty/unknown
#                   makes the ralph-loop hook re-fire into any session that
#                   stops on this project (see SKILL.md "Operations → start").
#
# Exits 1 if state/active.yaml already exists in the chosen sweep dir.

set -euo pipefail

EXPLICIT_SESSION=""
POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-id) EXPLICIT_SESSION="${2:?--session-id needs a value}"; shift 2 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]}"

SURFACES="${1:?surfaces required}"
MODE="${2:?mode required}"
RUN_ID="${3:-$(date -u +%Y-%m-%d-%H%M%S)-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SWEEP_DIR="$REPO_ROOT/docs/superpowers/sweeps/$RUN_ID"
STATE_DIR="$SWEEP_DIR/state"

if [[ -f "$STATE_DIR/active.yaml" ]]; then
  echo "ERROR: active.yaml already exists at $STATE_DIR" >&2
  echo "       Either /abadge-e2e-sweep resume or /abadge-e2e-sweep cancel first." >&2
  exit 1
fi

mkdir -p "$STATE_DIR/repros"

# active.yaml — the lock file
# Prefer the explicit --session-id arg (the controller should always pass this).
# CLAUDE_CODE_SESSION_ID is rarely exported into bash subshells, so the env
# fallback usually yields "unknown", which weakens the stop-hook's session
# isolation guard (see SKILL.md "Operations → start").
SESSION_ID="${EXPLICIT_SESSION:-${CLAUDE_CODE_SESSION_ID:-unknown}}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SURFACES_LIST="$(echo "$SURFACES" | tr ',' '\n' | sed 's/^/  - /')"

cat > "$STATE_DIR/active.yaml" <<YAML
---
run_id: $RUN_ID
session_id: $SESSION_ID
created_at: $NOW
mode: $MODE
parallel_limit: 4
checkpoint_interval: 10
saturation_threshold: 5
max_iterations: 100
surfaces:
$SURFACES_LIST
dev_url_api: http://localhost:8787
dev_url_web: http://localhost:3000
status: active
cancelled_at: null
completed_at: null
notes: |
  Initialised by sweep-init.sh
YAML

# plan.yaml — copy seed and filter by surface list
SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SEED="$SKILL_DIR/assets/plan-seed.yaml"

if [[ ! -f "$SEED" ]]; then
  echo "ERROR: seed plan not found at $SEED" >&2
  exit 1
fi

# Simple seed copy; controller can later regenerate with --add-missing
cp "$SEED" "$STATE_DIR/plan.yaml"

# progress.yaml — initial counters (controller will rewrite each iter)
cat > "$STATE_DIR/progress.yaml" <<YAML
---
last_updated: $NOW
iteration: 0
cells_total: 0
cells_done: 0
cells_in_progress: 0
cells_pending: 0
issues_total: 0
issues_open: 0
issues_closed: 0
findings_this_iter: 0
consecutive_zero_finding_iters: 0
last_advisor_iter: 0
next_advisor_iter: 10
per_surface: {}
recent_findings: []
YAML

# issues.md — header
cat > "$STATE_DIR/issues.md" <<MD
# Sweep Issues — Run $RUN_ID

Format: each issue starts with \`### §CODE — short title\` and includes
severity emoji + first-found iter, surface + plan-cell id, reproduction
path, suggested fix, status.
MD

# checkpoints.md — empty
cat > "$STATE_DIR/checkpoints.md" <<MD
# Sweep Checkpoints — Run $RUN_ID
MD

# iteration-log.md — empty
cat > "$STATE_DIR/iteration-log.md" <<MD
# Iteration Log — Run $RUN_ID
MD

cat <<MSG
✅ Sweep initialised.

run_id:      $RUN_ID
state_dir:   $STATE_DIR
mode:        $MODE
surfaces:    $SURFACES

Next: invoke /ralph-loop:ralph-loop with the iteration prompt at
$SKILL_DIR/scripts/sweep-iteration-prompt.md
MSG
