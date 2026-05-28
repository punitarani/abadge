# State Files — Exact Schemas

All state lives in `docs/superpowers/sweeps/<run-id>/state/`. The controller is the only writer; subagents return JSON to stdout and the controller commits it.

This is the contract. If a controller writes anything else into these files, future iterations will misread the campaign. Treat the schemas as load-bearing.

---

## `state/active.yaml`

Lock file declaring "a sweep is in flight". Existence ⇒ refuse `start`. Removal ⇒ run is finished or cancelled.

```yaml
---
run_id: 2026-04-22-114530-abc123       # date + short hash
session_id: 7add7453-7c68-485f-…       # claude-code session id (stamped by start, used by cancel)
created_at: 2026-04-22T11:45:30Z
mode: bfs | dfs | hybrid               # hybrid = bfs first pass, dfs after
parallel_limit: 4                      # max concurrent subagents per iter
checkpoint_interval: 10                # iterations between advisor() calls
saturation_threshold: 5                # consecutive zero-finding iters → saturation
max_iterations: 100                    # 0 ⇒ unlimited (discouraged)
surfaces: [api, cli, web, mcp, daemon, crypto, db, sdk, docs, static]
dev_url_api: http://localhost:8787
dev_url_web: http://localhost:3000
status: active | saturated | cancelled | complete
cancelled_at: null                     # set by sweep-cancel.sh
completed_at: null                     # set when SWEEP_COMPLETE is honestly emitted
notes: |
  free-form context the user passed at start
```

The skill refuses `start` while `status: active`. `resume` requires `status: active`. `report` reads any status.

---

## `state/plan.yaml`

The test matrix. One entry per `(cell, facet)`. `tested_at` is the only mutated field after init.

```yaml
---
generated_at: 2026-04-22T11:45:30Z
total: 412
pending: 412
in_progress: 0
done: 0
cells:
  - id: api.access.reveal-opaque.happy
    surface: api
    cell: access.reveal-opaque
    facet: happy
    status: pending | in_progress | done | skipped | blocked
    parallelizable: true
    requires: []                       # e.g. [playwright], [multi_org_user]
    priority: 1                        # 1 = critical, 5 = trivia
    tested_at: null                    # ISO timestamp when subagent returned
    iteration: null                    # iteration number that picked it
    finding_ids: []                    # references into issues.md
    notes: null                        # short subagent-provided summary

  - id: api.access.reveal-non-opaque.regression
    surface: api
    cell: access.reveal-non-opaque
    facet: regression
    status: pending
    parallelizable: true
    requires: []
    priority: 1
    refers_to: [§I2]                   # known prior issue this verifies
    tested_at: null
    iteration: null
    finding_ids: []
```

The controller picks pending entries via:
- BFS: round-robin across surfaces, lowest-priority-number first within each surface
- DFS: stay on the current surface until all its cells are `done`, then move to the next surface
- hybrid: BFS pass 1 (every surface gets one cell), then DFS pass 2 (drain each surface)

`requires` is checked against `active.yaml.surfaces` and live env (Playwright MCP connectivity, fixture-user existence).

---

## `state/progress.yaml`

Live counters. Updated every iter. The status command reads only this file.

```yaml
---
last_updated: 2026-04-22T13:12:08Z
iteration: 47
cells_total: 412
cells_done: 89
cells_in_progress: 4
cells_pending: 319
issues_total: 31
issues_open: 27
issues_closed: 4
findings_this_iter: 0
consecutive_zero_finding_iters: 3      # used by saturation gate
last_advisor_iter: 40
next_advisor_iter: 50
per_surface:
  api:    {total: 87, done: 22, open_issues: 8}
  cli:    {total: 36, done: 9,  open_issues: 3}
  web:    {total: 64, done: 14, open_issues: 9}
  mcp:    {total: 28, done: 8,  open_issues: 2}
  daemon: {total: 32, done: 10, open_issues: 1}
  crypto: {total: 24, done: 12, open_issues: 0}
  db:     {total: 40, done: 8,  open_issues: 1}
  sdk:    {total: 28, done: 4,  open_issues: 4}
  docs:   {total: 44, done: 2,  open_issues: 3}
  static: {total: 29, done: 0,  open_issues: 0}
recent_findings:                       # last 5; full list in issues.md
  - {id: "§I2", iter: 4, severity: high, surface: api}
  - {id: "§ON5", iter: 18, severity: high, surface: api}
  - {id: "§W2", iter: 26, severity: high, surface: web}
  - {id: "§W19", iter: 26, severity: high, surface: web}
  - {id: "§I5", iter: 33, severity: high, surface: api}
```

---

## `state/issues.md`

Append-only log of confirmed, deduplicated issues. The triager (subagent at `subagents/triager-prompt.md`) is the only entity allowed to mint a new bug code. Format mirrors the prior `TESTING.md` so existing tooling and human muscle memory both work.

```markdown
# Sweep Issues

Format: each issue starts with a `### §CODE — short title` line and includes:
- Severity emoji + first-found iter
- Surface + plan-cell id
- Reproduction (path to repros/<code>.<ext>)
- Suggested fix (file:line)
- Status (open | fixed | wontfix)

---

### 🟥 §I2 — decoder requires kind="opaque"; non-opaque kinds corrupt
**iter 4 · surface api · cell api.access.reveal-non-opaque.happy**

`packages/trpc/src/server/item-payload.ts:decodeServerManagedPayload` …

**Reproduction**: `state/repros/i2-envelope-misdelivery.ts`

**Fix**: `packages/core/src/secret-delivery.ts` — drop the `kind==="opaque"` gate; …

**Status**: open
```

The controller appends new sections; never deletes or rewrites. For dedupe (e.g. iter 80 hits the same bug as iter 4), the triager appends a one-line `**Re-confirmed iter 80**` under the existing section instead of creating §I2b.

---

## `state/checkpoints.md`

Advisor verdicts at every checkpoint interval (default every 10 iters) and on saturation triggers.

```markdown
# Sweep Checkpoints

### Iter 10 · 2026-04-22T12:34:11Z

Asked: "We've covered 22 plan cells with 6 high findings. Worth continuing or pivot?"

Verdict (advisor): "Continue. The web surface is undertested — only 1 cell touched. Prioritise web cells for the next 10 iters."

Action taken: re-prioritised web cells in plan.yaml from p3 → p1.

---

### Iter 47 · 2026-04-22T13:12:08Z (saturation trigger)

`consecutive_zero_finding_iters` hit 3 of 5. Asked advisor whether to stop early.

Verdict: "No — 5 web cells still pending; 2 of them touch onboarding. Run those before declaring saturation."

Action taken: continue.
```

---

## `state/iteration-log.md`

One short line per iteration. The audit trail. Cheap to grep.

```markdown
iter 47 · 2026-04-22T13:12:08Z · 4 cells (api.audit.list, web.items.list, mcp.tool.release_mount, daemon.json-rpc.required-param) · 0 new bugs · 0 dups merged · saturation 3/5
iter 46 · 2026-04-22T13:08:42Z · 4 cells (...) · 1 new bug §AUDIT5 · saturation 0/5
iter 45 · ...
```

---

## `state/repros/`

One file per confirmed bug, named `<code>-<short-name>.<ext>`. Format matches `scripts/repro/` from the prior campaign:

- `.ts` for runnable scripts (header comment lists `SESS / ORG / PROF` env)
- `.md` for manual-only repros (UI bugs needing a browser)

Generated by the tester subagent that confirmed the bug; controller writes the file. Never overwritten — if iter 80 re-confirms §I2 with a clearer repro, the new file is `i2-envelope-misdelivery-v2.ts` and the original stays.

---

## File ownership matrix

| File | Created by | Mutated by | Read by |
|---|---|---|---|
| `active.yaml` | `sweep-init.sh` | controller, `sweep-cancel.sh` | controller every iter |
| `plan.yaml` | `sweep-init.sh` (from `assets/plan-seed.yaml`) | controller (cell status only) | controller every iter |
| `progress.yaml` | `sweep-init.sh` | controller every iter | `sweep-status.sh`, controller |
| `issues.md` | `sweep-init.sh` (empty header) | controller (append only, via triager) | controller (last N for dedup) |
| `checkpoints.md` | `sweep-init.sh` (empty) | controller (append only) | human, advisor |
| `iteration-log.md` | `sweep-init.sh` (empty) | controller (append only) | `sweep-status.sh` |
| `repros/*` | `sweep-init.sh` mkdir | controller (write-once per file) | humans, regression CI |

The strict single-writer model is what makes ralph-style resumption safe. If two iterations ever raced (controller crash + immediate restart), the worst that happens is one finding gets re-discovered next iter and the triager merges it.

---

## Atomic-write convention

The controller always writes via temp + atomic rename to avoid torn reads from a `status` op:

```bash
T="${F}.tmp.$$"
write_to "$T"
mv "$T" "$F"
```

This applies to `progress.yaml` (rewritten each iter), `plan.yaml` (mutated each iter), and `active.yaml`. The append-only files (`issues.md`, `checkpoints.md`, `iteration-log.md`) use a single `>>` and accept the trivial torn-line risk.
