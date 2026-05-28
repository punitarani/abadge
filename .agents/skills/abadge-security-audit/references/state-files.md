# State File Schemas

All state lives under `docs/security-audit/<run-id>/state/`. The controller is the single writer. Finding/note files under `docs/security-audit/<run-id>/{findings,notes,pen-tests,wave-reports}/` are written by subagents but managed by the controller's plan.

This doc tracks **what `audit-init.sh` actually writes** (not an aspirational schema). If you edit either side, edit the other.

## `state/active.yaml`

Written by `audit-init.sh`. Mutated by the controller (status, current_wave, completed_at) and by `audit-cancel.sh` / `audit-recover.sh` (status, cancelled_at, cancelled_reason, session_id). One `---` opener, no closer — the rest of the file is flat YAML.

```yaml
---
run_id: 2026-04-22-114530-abc123
session_id: <claude code session id or "unknown">
created_at: 2026-04-22T11:45:30Z
git_sha: <HEAD at init>
parallel_limit: 4
checkpoint_interval: 5
saturation_zero_iters_required: 3    # zero-finding iters before advisor query
max_iterations: 120
current_wave: 1                       # 1 | 2 | 3 | 4
status: active                        # active | cancelled | completed
cancelled_at: null
completed_at: null
cancelled_reason: ""                  # set by audit-cancel.sh; first-class field
audit_dir: <absolute path>
notes: |
  Initialised by audit-init.sh. Contract is READ-ONLY — subagents may not
  modify source code, start servers, or run mutating commands.
```

## `state/plan.yaml`

Seeded from `assets/plan-seed.yaml` at init. Mutated by the controller each iteration: status transitions (`pending → in_progress → done | blocked`), `started_at`, `finished_at`, `findings_filed`, `blocked_reason`.

```yaml
---
generated_at: <iso>
total: 40                       # 11 + 12 + 12 + ≥4 (W4 grows as findings are filed)
cells:
  - id: W1S01
    wave: 1
    kind: surface                 # surface | threat | pentest | verifier
    scope: "apps/api — Hono routes, middleware, CORS, rate limit"
    notes_path: docs/security-audit/<run-id>/notes/api.md
    findings_prefix: W1S01
    parallelizable: true
    requires: []                  # e.g. [wave-1-complete] for W2+
    status: pending               # pending | in_progress | done | blocked
    started_at: null
    finished_at: null
    findings_filed: []            # IDs; populated after completion
    blocked_reason: null
  # ... 40 total seed cells, plus W4 verifiers added dynamically after W3
```

## `state/progress.yaml`

Written by `audit-init.sh`. Rewritten atomically (temp+rename) by the controller each iteration. Also rewritten by `audit-recover.sh reconcile-counts` to re-derive `findings_by_severity` and `integrity.*` from disk reality.

```yaml
---
last_updated: <iso>
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
  wave_1: null                   # iso timestamp when wave-N triage ran; null = not yet
  wave_2: null
  wave_3: null
  wave_4: null
integrity:
  critical_verified: 0           # count of Critical findings with `Verified:` frontmatter
  high_verified: 0               # count of High findings with `Verified:` frontmatter
  critical_unverified_ids: []    # IDs still missing W4 sign-off
  high_unverified_ids: []
recent_findings: []              # bounded list; newest first; controller caps length
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
