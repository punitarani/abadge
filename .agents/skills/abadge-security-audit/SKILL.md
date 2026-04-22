---
name: abadge-security-audit
description: Use when the user wants to run, resume, monitor, or stop a deep, multi-wave security/compliance audit of the abadge codebase — code review, pen testing, threat modelling, and the full cybersecurity review pipeline. Triggers on phrases like "security audit abadge", "pen test the codebase", "start the security review", "continue the security audit", "what did the audit find", "generate the security report", "stop the audit", "production readiness security checklist", or any request to methodically audit all trust boundaries of abadge (api, web, sdk, cli, mcp, daemon, crypto, auth, db) in a loop with subagents, durable finding files, and honest saturation gating. READ-ONLY by contract — no code edits. Distinct from abadge-e2e-sweep, which tests functional correctness; this skill reasons about adversarial behaviour.
---

# abadge Security Audit

Methodical, resumable, read-only, subagent-driven security & compliance audit of the abadge agent credential firewall. Runs in a ralph-style loop that survives compaction and session restarts because every finding, note, and progress counter lives on disk. The prior run (session `ff9f5b8d`, worktree `feat/sleepy-pascal-324a1c`) produced 139 findings across 4 waves — this skill encodes that methodology so future runs are the default experience.

**Announce on use:** "Using abadge-security-audit to <start|resume|status|report|cancel|reset> the audit."

## Core contract — READ-ONLY

Every subagent dispatched by this skill is bound by the same contract:

- **Allowed tools:** Read, Grep, Glob, Write (scoped to `docs/security-audit/` only), Bash (read-only commands only).
- **Forbidden:** Edit, touching product code, running `bun run build/dev/test`, git mutations (commit, push, checkout), starting servers/daemons, installing packages.
- **Output discipline:** each subagent writes a notes file (always) and zero-or-more finding files (using the template). The chat message is ≤30 lines: finding IDs, notes path, verdict. No pasted content.

Violation of read-only invalidates the audit. The skill embeds this in every dispatch envelope.

## Four waves

The audit proceeds in waves; each wave's outputs are inputs to the next. This progressive structure is what gives a security audit signal beyond noise.

| Wave | Purpose | Agent count | Gate before next |
|---|---|---|---|
| **W1 — Surface recon** | One auditor per package/layer. Inventory files, map trust boundaries, confirm/refute each invariant from `AGENTS.md`. | 11 (S01–S11) | All W1 notes files exist |
| **W2 — Threat-class deep-dive** | One auditor per OWASP-style class (authn, authz, crypto, session, input, disclosure, races, leakage, DoS, supply-chain, headers, audit-integrity). Uses W1 notes as input. | 12 (T01–T12) | All W2 notes files exist |
| **W3 — Pen tests** | Static exploit-path construction (not live exploitation) for 12 adversarial scenarios: forge session, bypass perm, IDOR, MCP leak, daemon replay, mode confusion, audit tamper, RBAC escalation, token theft, payload smuggle, DoS, socket squat. | 12 (P01–P12) | All W3 pen-test reports exist |
| **W4 — Verification** | Independent fresh-eyes re-test of every Critical + every High finding. Catches false positives and confirms exploit chains. | 3+ (V01+) | Every Critical/High has been verified or reclassified |

When all four waves have closed out cleanly, the skill emits the production-readiness checklist and a final report, and honestly reports DONE.

## Operations

The user invokes with one of: `start`, `resume`, `status`, `report`, `cancel`, `reset`. Default: `status`.

### `start [--wave 1-4] [--only <id>] [--parallel N] [--max-iterations N]`

1. Refuse if `state/active.yaml` already exists.
2. Run `scripts/audit-init.sh` which:
   - creates `docs/security-audit/` structure (00-AUDIT-PLAN, 01-METHODOLOGY, 02-SCOPE, 03-THREAT-MODEL-RECAP, 04-SEVERITY-RUBRIC, 05-TASKLIST, 06-PROMPT-TEMPLATE, findings/{critical,high,medium,low,informational}, notes/, pen-tests/, wave-reports/)
   - seeds plan from `assets/plan-seed.yaml` (40 cells — 11 surface, 12 threat, 12 pen-test, 4+ verify)
   - writes `state/` sibling: `active.yaml`, `plan.yaml`, `progress.yaml`, `iteration-log.md`
3. Verify worktree is clean (audit outputs are the only files touched). If dirty, warn and proceed.
4. Hand off to `/ralph-loop:ralph-loop` with `scripts/audit-iteration-prompt.md` as the prompt, `--completion-promise "AUDIT_COMPLETE"`, `--max-iterations` from flag (default 80).
5. Print run-id, state-dir, and the audit-dir path.

### `resume`

Re-attach to the existing run-id. Ralph gets a fresh `session_id`; plan.yaml tells the controller which cell to pick next. No data loss on session crash.

### `status`

Read-only dump of `state/progress.yaml` + last 10 iteration-log lines + counts under `docs/security-audit/findings/<severity>/`. Never mutates.

### `report`

Dispatches the reporter subagent with all the wave-reports, findings, and notes. Produces `docs/security-audit/99-FINAL-REPORT.md` plus `100-PRODUCTION-CHECKLIST.md` — format proven by the prior audit (executive summary, severity table, finding index, attack chains, remediation roadmap, checklist).

### `cancel`

Session-id-checked ralph removal. Preserves `state/` and all `docs/security-audit/` content. Safe to resume later.

### `reset`

Refuses without `--confirm`. Removes `state/` AND `docs/security-audit/`. Use only when starting a brand-new audit.

## Per-iteration loop (what ralph re-fires)

Lives at `scripts/audit-iteration-prompt.md`. Each iteration:

1. **READ STATE** — `state/active.yaml`, `state/plan.yaml`, `state/progress.yaml`.
2. **WAVE GATE** — if current wave not complete and no cells of prior waves pending, continue in current wave. Never start W2 until W1 is done; same for W3→W2, W4→W3.
3. **SATURATION CHECK** — if `consecutive_zero_finding_iters >= threshold`, call `advisor()` with current state. Honour CONTINUE / PIVOT / SATURATED per `references/saturation-detection.md`.
4. **PLAN-COMPLETE CHECK** — if all wave-4 verifier cells done AND every Critical/High has `verified: confirmed|invalid|reclassified`, emit `<promise>AUDIT_COMPLETE</promise>` and stop.
5. **PICK CELLS** — pick K = `parallel_limit` (default 3) undone cells from the current wave. Respect `parallelizable: false` (e.g. verifiers run serial).
6. **DISPATCH** — parallel `Task` calls, each with envelope from `subagents/_envelope.md` + surface/threat/pentest/verifier template. Pass `read_only: true`, wave prerequisites, path pointers.
7. **AGGREGATE** — each subagent returns a short JSON block (IDs of findings filed + notes path + verdict). Controller parses.
8. **TRIAGE + DEDUP** — dispatch triager if ≥1 new finding. Triager checks against existing findings (by CWE + file:line + title cosine) — per `references/dedup-protocol.md` — and merges duplicates.
9. **WRITE STATE** — update `plan.yaml` cell status, `progress.yaml` counters, append `iteration-log.md` one-liner.
10. **CHECKPOINT** — every `checkpoint_interval` (default 10) iters, call `advisor()` and write to `docs/security-audit/wave-reports/checkpoints.md`.
11. **CONTINUE** — output one short line and let ralph re-fire. Do NOT emit the completion promise unless step 4 said so.

## Durable state

Lives at `docs/security-audit/state/` (inside the audit dir so everything is co-located; `state/` is a subdirectory). See `references/state-files.md`.

```
docs/security-audit/
├── 00-AUDIT-PLAN.md            ← high-level plan (written at start)
├── 01-METHODOLOGY.md           ← the invariants of the audit method
├── 02-SCOPE.md                 ← what's in/out of scope
├── 03-THREAT-MODEL-RECAP.md    ← abadge-specific threat model
├── 04-SEVERITY-RUBRIC.md       ← how findings are rated
├── 05-TASKLIST.md              ← live tasklist — mirrors plan.yaml for humans
├── 06-PROMPT-TEMPLATE.md       ← the exact prompt skeleton used
├── README.md                   ← index
├── findings/{critical,high,medium,low,informational}/
│                               ← one .md per finding, template per finding-format.md
├── notes/                      ← one .md per surface + one per threat class
├── pen-tests/                  ← one .md per W3 scenario (static exploit path)
├── wave-reports/               ← one .md per wave + checkpoints.md + verification reports
├── state/
│   ├── active.yaml             ← lock file + run config
│   ├── plan.yaml               ← the cell matrix; mutated each iter
│   ├── progress.yaml           ← counters; rewritten each iter
│   └── iteration-log.md        ← append-only audit trail
├── 99-FINAL-REPORT.md          ← written by `report` op
└── 100-PRODUCTION-CHECKLIST.md ← written by `report` op
```

## Invariants (do not violate)

1. **Read-only.** Subagents may not touch product code. Violations are treated as audit bugs and the subagent's output is discarded.
2. **One audit per project at a time.** `state/active.yaml` is the lock.
3. **Don't fabricate completion.** `AUDIT_COMPLETE` is honest only when all W1–W4 cells are `done` AND every C/H finding has been verified. No early exit without advisor consent.
4. **Wave gates are serial.** W2 agents need W1 notes; W3 needs W1+W2; W4 needs W3. Don't race ahead.
5. **Evidence before assertion.** Every finding must cite `path:line`. Finding files without file-line references are auto-downgraded to Informational by the triager.
6. **Dedup first, file second.** Before minting a new finding ID, check existing findings for same CWE + file:line. Re-confirmations become amendments, not new findings.
7. **Severity is justified.** Each finding cites the severity-rubric row that applies. The triager downgrades when justification is missing.
8. **Verification is independent.** W4 verifiers must re-read the code from scratch; they may not inherit the filer's reasoning.

## Why this is distinct from abadge-e2e-sweep

| Dimension | abadge-e2e-sweep | abadge-security-audit |
|---|---|---|
| Goal | Does it work? | Can it be attacked? |
| Scope | Functional cells (endpoints, flows) | Trust boundaries, invariants, exploit paths |
| Code access | Read+Write+Bash (can mutate fixtures) | Read-only |
| Evidence | Live request/response | Static code citations + static exploit-path construction |
| Structure | Flat BFS/DFS matrix | Wave 1→4 progressive (surface → threat → pen-test → verify) |
| Output | TESTING.md + scripts/repro/ | Findings (by severity) + notes (by surface/threat) + pen-tests + wave reports + final report + production checklist |
| Exit | When bugs = 0 OR saturation | When every Critical/High is verified AND all plan cells done |

Both are resumable, both use ralph-loop, both dispatch subagents — but the subagent contracts are fundamentally different.

## Pointers into references/ and subagents/

Load when you need them. Not auto-loaded.

- `references/wave-model.md` — exact wave definitions + gates + what inputs each auditor gets
- `references/threat-model-recap.md` — abadge's invariants + trust boundaries in one page
- `references/severity-rubric.md` — Critical/High/Medium/Low/Informational definitions
- `references/finding-format.md` — exact finding-file template (matches 01-METHODOLOGY.md from prior audit)
- `references/subagent-contract.md` — JSON return shape + escalation rules + read-only enforcement
- `references/state-files.md` — active.yaml, plan.yaml, progress.yaml schemas
- `references/dedup-protocol.md` — how the triager merges duplicates
- `references/saturation-detection.md` — honest exit gate + advisor query template
- `references/loop-mechanics.md` — cooperation with ralph-loop

Subagent templates:
- `subagents/_envelope.md` — common envelope prepended to every template
- `subagents/wave1-surface.md` — per-surface auditor (W1S01–W1S11)
- `subagents/wave2-threat.md` — per-threat-class auditor (W2T01–W2T12)
- `subagents/wave3-pentest.md` — per-pen-test-scenario agent (W3P01–W3P12)
- `subagents/wave4-verifier.md` — fresh-eyes re-verifier
- `subagents/triager.md` — dedup + severity adjustment
- `subagents/reporter.md` — final report + production checklist generator

Scripts:
- `scripts/audit-init.sh` — creates docs/security-audit/* + state/ + seeds plan
- `scripts/audit-status.sh` — pure read; progress dump
- `scripts/audit-cancel.sh` — session-id-checked ralph removal; preserves state
- `scripts/audit-report.sh` — prints inputs for reporter subagent
- `scripts/audit-iteration-prompt.md` — the per-iter prompt fed to ralph

## Quick reference

| User says | Op | Effect |
|---|---|---|
| "start the security audit" | `start` | Init + seed + hand off to ralph |
| "continue the audit" / "resume" | `resume` | Re-attach to existing run-id |
| "what's the audit finding" | `status` | Progress + counts (read-only) |
| "generate the security report" / "production checklist" | `report` | Render `99-FINAL-REPORT.md` + `100-PRODUCTION-CHECKLIST.md` |
| "stop the audit" | `cancel` | Remove ralph state, preserve findings |
| "reset security audit" | `reset` | Destructive; requires `--confirm` |
