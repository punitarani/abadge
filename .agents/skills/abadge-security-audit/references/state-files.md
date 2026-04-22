# State File Schemas

All state lives under `docs/security-audit/state/`. The controller is the single writer. Finding/note files under `docs/security-audit/{findings,notes,pen-tests,wave-reports}/` are written by subagents but managed by the controller's plan.

## `state/active.yaml`

```yaml
---
run_id: 2026-04-22-114530-abc123
session_id: <claude code session id>
created_at: <iso>
wave: 1                         # 1 | 2 | 3 | 4
parallel_limit: 3               # max concurrent subagents per iter
checkpoint_interval: 10
saturation_threshold: 4         # iters with zero new findings before advisor query
max_iterations: 80
status: active | saturated | cancelled | complete
cancelled_at: null
completed_at: null
audit_dir: docs/security-audit
notes: |
  free-form at start; user-provided context
```

## `state/plan.yaml`

```yaml
---
generated_at: <iso>
total: 40                       # 11 + 12 + 12 + ≥4 (wave 4 grows with findings)
waves:
  1: {total: 11, done: 0, pending: 11, blocked: 0}
  2: {total: 12, done: 0, pending: 12, blocked: 0}
  3: {total: 12, done: 0, pending: 12, blocked: 0}
  4: {total: 0,  done: 0, pending: 0,  blocked: 0}   # seeded after W3 completes
cells:
  - id: W1S01
    wave: 1
    kind: surface                 # surface | threat | pentest | verifier
    scope: "apps/api — Hono routes, middleware, CORS, rate limit"
    notes_path: docs/security-audit/notes/api.md
    findings_prefix: W1S01
    parallelizable: true
    requires: []                  # e.g. [wave-1-complete] for W2+
    status: pending               # pending | in_progress | done | blocked
    started_at: null
    finished_at: null
    findings_filed: []            # IDs; populated after completion
    blocked_reason: null
  # ... 40 total seed cells, plus W4 verifiers added dynamically
```

## `state/progress.yaml`

```yaml
---
last_updated: <iso>
iteration: 0
cells_total: 40
cells_done: 0
cells_in_progress: 0
cells_pending: 40
cells_blocked: 0
findings:
  critical: 0
  high: 0
  medium: 0
  low: 0
  informational: 0
findings_total: 0
findings_verified: 0            # Critical/High with W4 stamp
findings_pending_verify: 0      # Critical/High without W4 stamp
findings_this_iter: 0
consecutive_zero_finding_iters: 0
last_advisor_iter: 0
next_advisor_iter: 10
current_wave: 1
wave_status:
  1: in_progress | complete | not_started
  2: not_started
  3: not_started
  4: not_started
recent_findings:
  - {id: "W1S06-001", severity: "high", surface: "daemon", iter: 3}
```

## `state/iteration-log.md`

Append-only, one line per iteration. Cheap to grep.

```
iter 1 · 2026-04-22T12:00:01Z · wave 1 · 3 cells (W1S01, W1S02, W1S03) · 2 new findings (W1S01-001 M, W1S02-001 I) · 0 dups · saturation 0/4
iter 2 · ...
```

## The audit-dir skeleton (also owned by this skill)

```
docs/security-audit/
├── 00-AUDIT-PLAN.md           ← written by audit-init.sh
├── 01-METHODOLOGY.md          ← written by audit-init.sh
├── 02-SCOPE.md                ← written by audit-init.sh
├── 03-THREAT-MODEL-RECAP.md   ← written by audit-init.sh (copy of reference)
├── 04-SEVERITY-RUBRIC.md      ← written by audit-init.sh (copy of reference)
├── 05-TASKLIST.md             ← live human-facing mirror of plan.yaml; re-rendered each iter
├── 06-PROMPT-TEMPLATE.md      ← written by audit-init.sh
├── README.md
├── findings/
│   ├── critical/
│   ├── high/
│   ├── medium/
│   ├── low/
│   └── informational/
├── notes/                     ← per surface + per threat class
├── pen-tests/                 ← per W3 scenario
├── wave-reports/              ← per wave
├── state/                     ← this skill's state
└── 99-FINAL-REPORT.md         ← written by `report` op
└── 100-PRODUCTION-CHECKLIST.md ← written by `report` op
```

## File-ownership matrix

| File | Created by | Mutated by | Read by |
|---|---|---|---|
| `state/active.yaml` | `audit-init.sh` | controller + `audit-cancel.sh` | controller every iter |
| `state/plan.yaml` | `audit-init.sh` | controller (status transitions + findings_filed) | controller every iter |
| `state/progress.yaml` | `audit-init.sh` | controller each iter (rewritten atomic) | `audit-status.sh`, controller |
| `state/iteration-log.md` | `audit-init.sh` | controller (append-only) | human, status |
| `findings/**/*.md` | tester subagents | — (immutable after filing; triager may append dedup notes) | verifier, reporter |
| `notes/*.md` | tester subagents | that same subagent during its run | later-wave subagents, reporter |
| `pen-tests/*.md` | W3 subagents | — | verifier, reporter |
| `wave-reports/wave-N.md` | controller at end-of-wave | controller during the wave | reporter |
| `05-TASKLIST.md` | controller each iter | controller each iter | human |

The strict single-writer model on state + immutable findings is what makes resume-after-crash safe.

## Atomic-write convention

Controller writes state/*.yaml via temp+rename:

```bash
T="$F.tmp.$$"
write_to "$T"
mv "$T" "$F"
```

Append-only files use `>>`.
