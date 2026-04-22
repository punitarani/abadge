#!/usr/bin/env bash
# audit-init.sh — initialise abadge-security-audit state and seed plan.
#
# Usage: audit-init.sh [run-id]
#   run-id : optional; auto-generated as YYYY-MM-DD-HHMMSS-<rand> if omitted.
#
# Creates docs/security-audit/<run-id>/state/ with active.yaml, plan.yaml,
# progress.yaml, plus stubs for findings/, notes/, pen-tests/, wave-reports/.
# Exits 1 if an active.yaml already exists for the chosen run-id.

set -euo pipefail

RUN_ID="${1:-$(date -u +%Y-%m-%d-%H%M%S)-$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUDIT_DIR="$REPO_ROOT/docs/security-audit/$RUN_ID"
STATE_DIR="$AUDIT_DIR/state"

if [[ -f "$STATE_DIR/active.yaml" ]]; then
  echo "ERROR: active.yaml already exists at $STATE_DIR" >&2
  echo "       Either resume, cancel, or choose a different run-id." >&2
  exit 1
fi

mkdir -p "$STATE_DIR" \
         "$AUDIT_DIR/findings/critical" \
         "$AUDIT_DIR/findings/high" \
         "$AUDIT_DIR/findings/medium" \
         "$AUDIT_DIR/findings/low" \
         "$AUDIT_DIR/findings/informational" \
         "$AUDIT_DIR/findings/merged" \
         "$AUDIT_DIR/notes" \
         "$AUDIT_DIR/pen-tests" \
         "$AUDIT_DIR/wave-reports"

SESSION_ID="${CLAUDE_CODE_SESSION_ID:-unknown}"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

cat > "$STATE_DIR/active.yaml" <<YAML
---
run_id: $RUN_ID
session_id: $SESSION_ID
created_at: $NOW
git_sha: $GIT_SHA
parallel_limit: 4
checkpoint_interval: 5
saturation_zero_iters_required: 3
max_iterations: 120
current_wave: 1
status: active
cancelled_at: null
completed_at: null
audit_dir: $AUDIT_DIR
notes: |
  Initialised by audit-init.sh. Contract is READ-ONLY — subagents may not
  modify source code, start servers, or run mutating commands.
YAML

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SEED="$SKILL_DIR/assets/plan-seed.yaml"

if [[ ! -f "$SEED" ]]; then
  echo "ERROR: seed plan not found at $SEED" >&2
  exit 1
fi
cp "$SEED" "$STATE_DIR/plan.yaml"

cat > "$STATE_DIR/progress.yaml" <<YAML
---
last_updated: $NOW
iteration: 0
wave_1: {dispatched: 0, completed: 0, blocked: 0}
wave_2: {dispatched: 0, completed: 0, blocked: 0}
wave_3: {dispatched: 0, completed: 0, blocked: 0}
wave_4: {dispatched: 0, completed: 0, blocked: 0}
findings_by_severity: {critical: 0, high: 0, medium: 0, low: 0, informational: 0}
findings_this_iter: 0
consecutive_zero_finding_iters: 0
last_advisor_iter: 0
next_advisor_iter: 5
triage:
  wave_1: null
  wave_2: null
  wave_3: null
  wave_4: null
integrity:
  critical_verified: 0
  high_verified: 0
  critical_unverified_ids: []
  high_unverified_ids: []
recent_findings: []
YAML

cat > "$AUDIT_DIR/INDEX.md" <<MD
# Security Audit — Run $RUN_ID

**Started:** $NOW
**Commit:** \`$GIT_SHA\`
**Status:** active
**Contract:** READ-ONLY — no source edits, no running servers, static analysis + static exploit pathing only.

## Layout
- \`state/\` — active.yaml / plan.yaml / progress.yaml
- \`findings/<sev>/\` — one file per defect
- \`notes/\` — per-subagent audit notes
- \`pen-tests/\` — Wave 3 adversarial scenario reports
- \`wave-reports/\` — per-wave triage and verification reports

On completion, \`REPORT.md\`, \`EXECUTIVE-SUMMARY.md\`, and \`REMEDIATION-BACKLOG.md\` land here.
MD

cat <<MSG
Audit initialised.

run_id:    $RUN_ID
audit_dir: $AUDIT_DIR
git_sha:   $GIT_SHA

Next:
  1. /ralph-loop:ralph-loop with the iteration prompt at
     $SKILL_DIR/scripts/audit-iteration-prompt.md
  2. Or: resume an existing session by re-running the iteration prompt.
  3. To check status:  $SKILL_DIR/scripts/audit-status.sh
  4. To cancel:        $SKILL_DIR/scripts/audit-cancel.sh
MSG
