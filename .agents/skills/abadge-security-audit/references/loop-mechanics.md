# Loop Mechanics — Cooperating with ralph-loop

Identical to `abadge-e2e-sweep`'s approach — don't reimplement what ralph-loop does well. Delegate the re-fire mechanics to ralph-loop; layer the audit-specific state and iteration logic on top.

## Separation of concerns

| Layer | Owner | Lives in |
|---|---|---|
| Loop drive (Stop-hook re-feed) | `ralph-loop` plugin | `.claude/ralph-loop.local.md` |
| Audit state (plan, progress, findings) | this skill | `docs/security-audit/state/` + audit dir |
| Loop start | `start` op | invokes `/ralph-loop:ralph-loop` |
| Loop cancel | `cancel` op | invokes `scripts/audit-cancel.sh` → optionally removes ralph state after session-id check |

## Start handoff sequence

```
1. controller: invokes /abadge-security-audit start
2. controller: refuse if docs/security-audit/state/active.yaml exists; bail
3. controller: bash scripts/audit-init.sh <flags>
   → creates docs/security-audit/{00-AUDIT-PLAN, 01-METHODOLOGY, 02-SCOPE, 03-THREAT-MODEL-RECAP, 04-SEVERITY-RUBRIC, 05-TASKLIST, 06-PROMPT-TEMPLATE, README, state/active.yaml, state/plan.yaml, state/progress.yaml, findings/{critical,high,medium,low,informational}, notes/, pen-tests/, wave-reports/}
4. controller: invokes /ralph-loop:ralph-loop with:
   - prompt: contents of scripts/audit-iteration-prompt.md (verbatim)
   - --completion-promise: "AUDIT_COMPLETE"
   - --max-iterations: from flag (default 80)
5. ralph stamps session_id
6. controller: prints run-id, state-dir, audit-dir
7. ralph fires the prompt as iter 1; audit-iteration-prompt.md runs
```

## Resume handoff sequence

```
1. controller: invokes /abadge-security-audit resume
2. controller: read state/active.yaml; bail if status != active
3. controller: invokes /ralph-loop:ralph-loop with same prompt and remaining iters
4. new ralph session; new session_id
5. iter N+1 reads state/plan.yaml → picks next pending cell → continues
```

Each iteration re-reads state. Crash-safe: if the session dies mid-iter, the next iteration starts clean from whatever was last committed to state/*.

## Cancel sequence

`scripts/audit-cancel.sh`:

1. Read `.claude/ralph-loop.local.md` → extract session_id
2. If session_id matches current session → `rm .claude/ralph-loop.local.md`
3. If not → leave ralph alone; tell user to cancel from that session
4. Update `state/active.yaml` → `status: cancelled, cancelled_at: <iso>`
5. Append cancel line to `iteration-log.md`

Never deletes `docs/security-audit/`. State + findings persist. Resume later, or run `report` to generate the final doc from whatever's on disk.

## Multi-session safety

Only one session at a time runs ralph for a given sweep. `session_id` fields in both `active.yaml` and `.claude/ralph-loop.local.md` enforce isolation. If the user opens a second Claude session in the same worktree, `status` and `report` ops work (they're read-only); `resume`, `cancel`, `reset` respect session ownership.

## Cooperation with `--completion-promise`

Controller always passes `--completion-promise "AUDIT_COMPLETE"`. The controller ONLY emits `<promise>AUDIT_COMPLETE</promise>` when the integrity gate in `saturation-detection.md` passes. Lying to exit is the failure mode we explicitly guard against.

## Iteration budget guidance

- Default `--max-iterations 80`. Prior audit ran ≈38 subagents to converge on 139 findings; at K=3 parallel that's ~13 iters for dispatch + ~5-10 iters for triage, wave summaries, and verification = ~25 iters typical. 80 is 3× that for safety.
- For a partial audit (`--wave 1` only), use 20.
- Never pass `--max-iterations 0`. Security audits should have a bounded budget.

## Race & error matrix

| Race | Outcome |
|---|---|
| Two sessions try `start` simultaneously | Second fails when it tries to create state/active.yaml (file exists) |
| Cancel from wrong session | Script refuses; prints which session owns the loop |
| Subagent writes outside `docs/security-audit/` | Contract violation; controller discards output; marks cell blocked |
| Subagent runs forbidden command | Same; the subagent's own restricted toolset usually catches this |
| State file corrupted | Controller fails closed; audit-iteration-prompt.md instructs to emit promise (graceful exit; not a lie because no state to complete) |

## Why no custom Stop hook?

Same reason as `abadge-e2e-sweep`: don't reimplement what ralph handles; skills can't install hooks cleanly; stacking hooks creates ordering bugs. Delegate.
