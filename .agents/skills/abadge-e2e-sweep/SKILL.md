---
name: abadge-e2e-sweep
description: Use when the user wants to run, resume, monitor, or stop a long-running end-to-end test sweep of the abadge codebase (web, API, CLI, MCP, daemon, crypto, DB, SDK), including phrases like "sweep abadge", "run the e2e audit", "continue the test campaign", "resume the sweep", "what's the sweep finding", "stop the sweep", or any request to methodically test every surface of abadge in a loop with subagents and durable issue tracking.
---

# abadge E2E Sweep

Methodical, resumable, subagent-driven test campaign across every abadge surface. Runs in a ralph-style loop that survives compaction and session restarts because all state lives in files. Lessons baked in from the prior 224-iteration campaign that produced 184 catalogued issues — including the saturation gate that earlier campaign never had.

**Announce on use:** "Using abadge-e2e-sweep to <start|resume|status|report|cancel> the sweep."

## Mental model

The sweep is a 2-D matrix:

| | happy path | adversarial | edge | regression |
|--|--|--|--|--|
| API | … | … | … | … |
| CLI | … | … | … | … |
| Web | … | … | … | … |
| MCP | … | … | … | … |
| Daemon | … | … | … | … |
| Crypto | … | … | … | … |
| DB | … | … | … | … |
| SDK | … | … | … | … |
| Docs | … | … | … | … |

Each cell is a *test bundle*: a focused subagent prompt with explicit scope and a JSON report contract.

The controller (the main session) walks the matrix BFS by default (one cell per surface, then rotate), then DFS into surfaces with open findings. Every iteration it:

1. Reads `state/plan.yaml` to pick the next undone cell
2. Dispatches one or more subagents (in parallel when independent)
3. Aggregates JSON reports
4. Runs the **bug-triager** subagent against `state/issues.md` to dedupe
5. Updates progress + saturation counters
6. Calls `advisor()` at planned checkpoints

The outer loop is **ralph-loop** — the same prompt re-fires every iteration; files carry the memory.

## Operations

The user invokes the skill with one of: `start`, `resume`, `status`, `doctor`, `recover`, `report`, `cancel`, `reset`. If no operation is given, default to `status` (it's the safest read-only op).

### `start [--surfaces api,cli,...] [--max-iterations N] [--mode bfs|dfs|hybrid]`

1. Refuse if `state/active.yaml` already exists — direct the user to `resume` or `cancel` first.
2. Capture the controller's Claude Code session id (ask the user, or read `$CLAUDE_CODE_SESSION_ID` from their terminal). You will need it in step 3.
3. Run `scripts/sweep-init.sh <surfaces> <mode> --session-id <id>` to create `state/` directory under `docs/superpowers/sweeps/<run-id>/` and seed `plan.yaml` from `assets/plan-seed.yaml`. Passing the session id explicitly is important — otherwise the stop-hook's session-isolation guard degrades to "any session drives the loop," which is how a dead controller leaves a zombie driver that hijacks unrelated sessions.
4. Verify the dev stack is alive (`bun run dev` ports 3000 + 8787/8788) — if not, prompt the user to start it before continuing. Do **not** start it for them; that's a foreground process they need to own.
5. Hand off to the loop engine by running:
   ```
   /ralph-loop:ralph-loop "$(cat scripts/sweep-iteration-prompt.md)" --max-iterations <N> --completion-promise "SWEEP_COMPLETE"
   ```
6. Print the run-id and state-dir path so the user can `tail` it externally.

### `resume`

**Resume continues an existing run in place. It never creates a new run, never overwrites sweep memory, and never rewrites `active.yaml`'s run-config fields.** Its only job is to re-attach the ralph-loop driver to state that already exists.

1. Refuse if `state/active.yaml` is missing — direct to `start`. (A missing active.yaml means there is nothing to resume.)
2. Read `state/active.yaml` for run-id, surface list, mode, and max iters. Do not modify those fields — they belong to the original run.
3. If `status: cancelled` or `status: completed`: refuse and surface the current status. Explicit `recover uncancel --apply` is required to revive a cancelled run; completed runs should not be revived at all.
4. Ensure the ralph-loop state exists and names this session. Rather than calling `/ralph-loop:ralph-loop` from scratch (which would stamp a fresh `started_at` and potentially reset the iteration counter), invoke:
   ```
   scripts/sweep-recover.sh reseed-ralph --apply
   scripts/sweep-recover.sh set-session <your-session-id> --apply
   ```
   `reseed-ralph` reads the existing `progress.yaml.iteration` and writes the ralph state with that iteration as the starting point — so the very next stop-hook fires iteration N+1 of the same run, not iteration 1 of a new one. It refuses to clobber a ralph state younger than 60 s without `--force`, so running it when a live loop exists is safe.
5. Tell the user the run-id the loop re-attached to, the current iteration, and that findings/plan/progress are preserved untouched.

Resume is a boundary, not a restart. The sweep's memory — `plan.yaml`, `progress.yaml`, `issues.md`, `iteration-log.md`, `repros/` — is owned by the original run and must not be rewritten, truncated, or re-seeded during resume. If any of those files are corrupt, that is a `reset` (destructive) conversation, not `resume`.

### `status`

Read `state/progress.yaml` and print:
- run-id, started_at, current iteration / max
- per-surface counts: `tested / total`, `open_issues / closed`
- top 3 most-recent findings (last `issues.md` entries)
- saturation flag (consecutive zero-finding iters)
- next planned cells

This is a pure read; never mutates state.

### `doctor`

Run `scripts/sweep-doctor.sh` to diagnose why the loop looks stuck. Read-only. It checks:

- Is the sweep state dir discoverable from the current cwd? (Matters because worktrees each have their own `docs/superpowers/sweeps/` tree.)
- Does `active.yaml` exist and have `status: active`? Flag if `cancelled` / `completed`.
- Does `.claude/ralph-loop.local.md` exist? If missing while the sweep is active, the loop driver is gone — nothing will re-fire.
- Is ralph's `iteration` numeric, and below `max_iterations`? If the hook sees non-numeric or `iteration >= max`, it terminates the loop on the next stop.
- Does ralph's `session_id` match the current `$CLAUDE_CODE_SESSION_ID`? If mismatched and non-empty, this session's stop-hook exits without re-firing.
- Drift between ralph iteration and `progress.yaml` iteration (>2 suggests a previous iteration crashed).
- Is the iteration-prompt file readable at the path the ralph state references?
- Are the dev-stack URLs reachable (`:8787`, `:8788`, `:3000`)? Non-fatal, but unreachable stacks block most cells.

Prints `[info]` / `[warn]` / `[PROB]` lines, and alongside each problem the exact `sweep-recover.sh` invocation that fixes it. Exits 0 on no problems, 1 otherwise — handy for CI-style babysitter loops.

### `recover`

Run `scripts/sweep-recover.sh <subcommand> [args] [--apply]` to fix specific blockers. Every invocation is **dry-run by default** — the user must pass `--apply` to actually mutate files. Every mutation writes a `.bak.<epoch>` sidecar before replacing the target. Subcommands:

- `reseed-ralph [--max N] [--force]` — rebuild `.claude/ralph-loop.local.md` from `active.yaml + progress.yaml` when the ralph state is missing, corrupt, or stale. Refuses to overwrite a state file younger than 60 s without `--force` (avoids racing a live stop-hook).
- `bump-max [N=100]` — increase `max_iterations` in ralph state when the iteration budget is about to be exhausted.
- `set-session [ID]` — write `$CLAUDE_CODE_SESSION_ID` (or a supplied id) into both ralph state and `active.yaml`. Needed when the stop-hook in the current session is exiting without re-firing because the state names a different session.
- `uncancel` — flip `active.yaml`'s `status: cancelled` back to `active` so `/resume` will pick the run up. Refuses if status is `completed`.
- `all` — run the four above, each gated on its own precondition.

Invariant: **recover never touches `issues.md`, `plan.yaml`, `progress.yaml`, or `repros/`**. Those are the sweep's memory of what was tested and found; recover only fixes the drivers around them so the loop can resume. If sweep memory itself is corrupt, that's a `reset` (destructive) conversation, not recover.

### `report`

Run `scripts/sweep-report.sh` to render `state/REPORT.md` from `plan.yaml + progress.yaml + issues.md`. Format mirrors the prior `TESTING.md` (Final counts, Headline regression chain if applicable, Fix Priority roadmap, Surface assessment, Iteration log). Print the path.

### `cancel`

1. Run `scripts/sweep-cancel.sh` which removes `.claude/ralph-loop.local.md` (if it belongs to this run's session) and writes `cancelled_at` into `state/active.yaml` (preserved, not deleted).
2. Print the final progress snapshot.
3. Tell the user `state/` is intact and `report` will still work.

### `reset`

Destructive — refuses without `--confirm`. Removes the entire `state/` directory and any associated ralph state. Use only when starting a brand-new campaign.

## Per-iteration loop body (what ralph re-fires)

This is the prompt template at `scripts/sweep-iteration-prompt.md`. The controller (you, in the loop) executes it every iteration:

```
You are running iteration N of the abadge E2E sweep.

1. READ state files:
   - state/active.yaml          → run config, mode, surface filter
   - state/plan.yaml            → matrix; find next K undone cells
   - state/progress.yaml        → consecutive_zero_finding_iters, saturation_threshold
   - state/issues.md (last 50 entries) → dedup context

2. SATURATION CHECK:
   If consecutive_zero_finding_iters >= saturation_threshold (default 5),
   call advisor() with the current state and ask: "Is this campaign saturated?".
   If advisor says yes, write SATURATED to state/active.yaml and output
   <promise>SWEEP_COMPLETE</promise>. Do not lie to exit — advisor must agree.

3. PLAN-COMPLETE CHECK:
   If every plan.yaml cell has tested_at AND there are zero open P0 issues,
   output <promise>SWEEP_COMPLETE</promise>.

4. DISPATCH (parallel):
   Pick K = min(parallel_limit, undone_cells). For each cell, dispatch a
   tester subagent using subagents/<surface>-prompt.md as the template.
   Pass the cell's scope, the dev URL, and a fresh repro skeleton path.

5. AGGREGATE:
   Each subagent returns a JSON report (schema in references/subagent-contract.md).
   Parse all reports.

6. TRIAGE:
   Dispatch bug-triager subagent with: {new_findings, existing_issues_md_tail}.
   Triager returns: per-finding {dup_of, severity, dedup_action}.

7. WRITE state:
   - Append non-duplicate findings to state/issues.md
   - Update plan.yaml cells with tested_at, finding_ids
   - Update progress.yaml counters + saturation
   - Drop any new repro into state/repros/

8. CHECKPOINT:
   Every CHECKPOINT_INTERVAL iterations (default 10), call advisor() with a
   short status and ask for strategic guidance. Save advisor verdict into
   state/checkpoints.md.

9. CONTINUE:
   Output exactly: "iter N: <K cells tested>, <new bugs>, <dups merged>,
   saturation <consecutive_zero>/<threshold>" and let the ralph hook re-fire.
   Do NOT output the completion promise unless step 2 or 3 said to.
```

## File contract (the durable state)

Lives at `docs/superpowers/sweeps/<run-id>/state/`. See `references/state-files.md` for full schemas.

```
state/
├── active.yaml         # one-of-a-kind: declares this run is in flight
├── plan.yaml           # the test matrix; mutated as cells complete
├── progress.yaml       # counters, saturation, checkpoints
├── issues.md           # bug log (dedup'd, severity-tagged)
├── checkpoints.md      # advisor strategic notes
├── iteration-log.md    # one short line per iter (audit trail)
└── repros/             # one .ts or .md per confirmed bug
```

These files are the only place memory persists across iterations and across sessions. The session can be killed and resumed; the worktree can move; only the state dir matters.

## What lives in references/

- `references/surface-map.md` — full inventory of abadge surfaces with file:line pointers (lifted from AGENTS.md + the prior TESTING.md). The seed for `plan.yaml`.
- `references/state-files.md` — exact YAML/MD schemas for every state file.
- `references/subagent-contract.md` — JSON return schema, error handling, escalation rules for tester subagents.
- `references/dedup-protocol.md` — how the triager merges duplicate findings; severity rubric.
- `references/saturation-detection.md` — what counts as a zero-finding iter, when to involve advisor, how to honestly write SWEEP_COMPLETE.
- `references/loop-mechanics.md` — exactly how this skill cooperates with the ralph-loop plugin (state file ownership, session-id isolation, cancel semantics).

When you (the controller) need any of those, read the file directly with the Read tool. They are not auto-loaded.

## What lives in subagents/

One prompt template per surface. Each is a self-contained dispatchable prompt that takes `{cell, dev_urls, prior_findings_summary}` and returns a JSON report per the contract.

- `api-prompt.md`, `cli-prompt.md`, `web-prompt.md`, `mcp-prompt.md`, `daemon-prompt.md`, `crypto-prompt.md`, `db-prompt.md`, `sdk-prompt.md`, `docs-prompt.md`
- `triager-prompt.md` (dedup + severity)
- `reporter-prompt.md` (used by `report` op to render `REPORT.md`)

## What lives in scripts/

Plain bash, idempotent, shellcheck-clean.

- `sweep-init.sh <surfaces> <mode>` — creates state dir, seeds plan, writes active.yaml
- `sweep-status.sh` — prints status table; pure read
- `sweep-report.sh` — renders REPORT.md
- `sweep-cancel.sh` — removes ralph state file (after session-id check), marks active.yaml cancelled
- `sweep-iteration-prompt.md` — the template fed to /ralph-loop on start/resume

## Invariants (do not violate)

1. **Files are the only memory.** Never assume the next iteration sees your reasoning. Write what you learned to `iteration-log.md` (one line) and `issues.md` (if new finding) before yielding.
2. **One sweep per project at a time.** `state/active.yaml` is the lock. Refuse to start while one exists.
3. **Don't fabricate completion.** `SWEEP_COMPLETE` is only honest when (a) every plan cell has `tested_at` and zero open P0 issues, OR (b) advisor() agreed the work is saturated. Lying to exit the loop is the failure mode that wasted 110 iterations last time.
4. **Subagents are isolated.** Never paste the controller's full conversation into a subagent prompt. Pass only: scope cell, dev URLs, last N issue titles for dedup, and the contract schema.
5. **Parallel safety.** Two subagents may not write to the same file. The controller owns all state writes; subagents only return JSON.
6. **No destructive actions without `--confirm`.** `reset`, removing repros, dropping the dev DB.
7. **Respect the dev stack.** The user owns `bun run dev`. Refuse to (re)start it; only verify it's alive.
8. **Cap subagent concurrency.** Default 4 parallel testers per iter. Higher risks rate limits and context churn.

## Common failure modes (and the counters)

| Failure | Counter |
|---|---|
| Loop runs forever after value runs out | Saturation gate at step 2 + advisor checkpoint at step 8 |
| Same bug reported 30 times | Triager step 6 with `references/dedup-protocol.md` |
| Subagent context bleed | Strict prompt template; the controller curates context |
| State files contradict each other | Single owner: the controller writes, never the subagents |
| User loses progress on session crash | All progress in `state/`; `resume` re-attaches |
| Worktree pollution from test scripts | All scratch goes under `state/repros/`; no top-level files |
| ralph state belongs to another session | `sweep-cancel.sh` checks `session_id:` before removing |

## Integration with other skills

- **superpowers:dispatching-parallel-agents** — this skill IS that pattern, applied to a long-running surface sweep.
- **superpowers:subagent-driven-development** — same controller/subagent split; here the "tasks" are sweep cells, not plan tasks.
- **superpowers:test-driven-development** — when a sweep finding produces a fix-it task, hand off to TDD per fix.
- **ralph-loop:ralph-loop** — the loop engine. This skill cooperates with it; doesn't reimplement.

## Quick reference

| User says | Op | Effect |
|---|---|---|
| "start the sweep" | `start` | Init state, seed plan, hand off to ralph |
| "continue testing" | `resume` | Re-attach to the last run-id |
| "what's the sweep doing" | `status` | Print progress (read-only) |
| "the loop looks stuck" / "why isn't it iterating" | `doctor` | Diagnose loop + state (read-only); prints recover commands |
| "unblock the loop" / "get it running again" | `recover <subcmd> --apply` | Targeted fix (dry-run by default): reseed-ralph / bump-max / set-session / uncancel / all |
| "give me the bug list" | `report` | Render REPORT.md |
| "stop the sweep" | `cancel` | Remove ralph state, preserve findings |
| "reset everything" | `reset` | Destructive; requires `--confirm` |
