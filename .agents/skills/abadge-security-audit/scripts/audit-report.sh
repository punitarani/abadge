#!/usr/bin/env bash
# audit-report.sh — print a one-page textual summary of the audit so far.
# Read-only. Used by the "report" op to answer "what has the audit found".
#
# Usage: audit-report.sh [run-id]

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
AUDITS_ROOT="$REPO_ROOT/docs/security-audit"

if [[ -n "${1:-}" ]]; then
  AUDIT_DIR="$AUDITS_ROOT/$1"
else
  STATE_DIR="$(find "$AUDITS_ROOT" -maxdepth 3 -name active.yaml -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null \
    | head -n 1 \
    | xargs dirname 2>/dev/null || true)"
  AUDIT_DIR="$(dirname "${STATE_DIR:-}")"
fi

if [[ -z "${AUDIT_DIR:-}" ]] || [[ ! -d "$AUDIT_DIR/findings" ]]; then
  echo "No audit found. Run audit-init.sh first." >&2
  exit 1
fi

echo "# abadge security audit — interim summary"
echo
echo "audit_dir: $AUDIT_DIR"
echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

echo "## Counts by severity"
for sev in critical high medium low informational; do
  n=$(find "$AUDIT_DIR/findings/$sev" -maxdepth 1 -name '*.md' 2>/dev/null | wc -l | tr -d ' ')
  printf "  %-15s %s\n" "$sev" "$n"
done
echo

# Extract a frontmatter field by name. Only reads the region between the
# first `---` line and the second `---` line, so narrative prose matching
# `Verified:` in the finding body is correctly ignored. Needed because the
# AUDIT_COMPLETE gate keys on Critical/High having a Verified: frontmatter.
fm_field() {
  local f="$1" k="$2"
  awk -v key="$k" '
    /^---$/ {fm = !fm; next}
    fm && $1 == key":" {sub(/^[^:]+: */, ""); print; exit}
  ' "$f"
}

echo "## Critical findings"
find "$AUDIT_DIR/findings/critical" -maxdepth 1 -name '*.md' 2>/dev/null | sort | while read -r f; do
  title=$(grep -m1 '^# ' "$f" 2>/dev/null | sed 's/^# //')
  verified=$(fm_field "$f" Verified)
  printf "  - %s %s  {verified: %s}\n" "$(basename "$f" .md)" "$title" "${verified:-unverified}"
done
echo

echo "## High findings"
find "$AUDIT_DIR/findings/high" -maxdepth 1 -name '*.md' 2>/dev/null | sort | while read -r f; do
  title=$(grep -m1 '^# ' "$f" 2>/dev/null | sed 's/^# //')
  verified=$(fm_field "$f" Verified)
  printf "  - %s %s  {verified: %s}\n" "$(basename "$f" .md)" "$title" "${verified:-unverified}"
done
echo

echo "## Latest wave reports"
ls -t "$AUDIT_DIR/wave-reports"/*.md 2>/dev/null | head -5 | while read -r f; do
  echo "  - ${f#$AUDIT_DIR/}"
done
echo

echo "## Pen-test scenarios filed"
find "$AUDIT_DIR/pen-tests" -name '*.md' 2>/dev/null | sort | while read -r f; do
  verdict=$(grep -m1 '^\*\*Verdict:\*\*' "$f" 2>/dev/null | sed 's/\*\*Verdict:\*\* *//')
  printf "  - %s  [%s]\n" "$(basename "$f" .md)" "${verdict:-?}"
done
echo

if [[ -f "$AUDIT_DIR/REPORT.md" ]]; then
  echo "Final REPORT.md already generated at $AUDIT_DIR/REPORT.md"
fi
