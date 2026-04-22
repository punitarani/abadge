# Loop Mechanics — Cooperating with ralph-loop

This skill does **not** install its own Stop hook. It uses the `ralph-loop` plugin (`/ralph-loop:ralph-loop` and `/ralph-loop:cancel-ralph`) as the loop engine and layers its own state management on top.

## How ralph-loop works (so we don't surprise it)

- ralph-loop's `setup-ralph-loop.sh` creates `.claude/ralph-loop.local.md` with YAML frontmatter (`iteration`, `max_iterations`, `completion_promise`, `session_id`) and a body containing the prompt.
- A Stop hook reads that file on every Stop event. If the file exists AND the session matches, it parses the assistant's last text block from the transcript, looks for `<promise>...</promise>`, increments `iteration`, and re-fires the same prompt verbatim by returning `{"decision":"block","reason":"<prompt>","systemMessage":"…"}`.
- Iteration counter and max iterations are enforced inside the hook. If max is hit, the hook removes the state file and exits cleanly.
- `session_id` isolation: the hook only fires for the session that started the loop. Other Claude sessions in the same project can run normally.

## What the abadge-e2e-sweep skill puts on top

| Layer | Owner | Lives in |
|---|---|---|
| Loop drive (Stop-hook re-feed) | ralph-loop plugin | `.claude/ralph-loop.local.md` |
| Sweep state (plan, progress, issues) | abadge-e2e-sweep | `docs/superpowers/sweeps/<run-id>/state/` |
| Loop start | abadge-e2e-sweep `start` op | invokes `/ralph-loop:ralph-loop` |
| Loop cancel | abadge-e2e-sweep `cancel` op | invokes `/ralph-loop:cancel-ralph` (with session-id check) |

The sweep state and the ralph state are independent. You can wipe the ralph state mid-run and the sweep state survives (loop pauses but `resume` re-attaches). You can wipe the sweep state and ralph keeps firing identically (controller bricks because there's no plan to read — fail fast, surface error to user).

## Start handoff sequence

```
1. controller: invokes /abadge-e2e-sweep start
2. controller: refuse if state/active.yaml exists; bail
3. controller: bash scripts/sweep-init.sh <surfaces> <mode> <run_id>
   → creates state/{active,plan,progress}.yaml + empty issues/checkpoints/iteration-log + repros/
4. controller: verifies dev stack alive (curl localhost:8787/health, localhost:3000)
   → if not, prompt user; do not start it
5. controller: invokes /ralph-loop:ralph-loop with:
   - prompt: contents of scripts/sweep-iteration-prompt.md (verbatim)
   - --max-iterations: from --max-iterations flag (default 100)
   - --completion-promise: "SWEEP_COMPLETE"
6. ralph-loop creates .claude/ralph-loop.local.md with session_id stamped
7. controller: prints run-id, state-dir path, "ralph attached"
8. ralph fires the prompt as iteration 1; sweep-iteration-prompt.md runs
```

## Resume handoff sequence

```
1. controller: invokes /abadge-e2e-sweep resume
2. controller: read state/active.yaml; bail if status != active
3. controller: read state/progress.yaml.iteration; compute remaining iters
4. controller: invokes /ralph-loop:ralph-loop with same prompt and remaining iters
5. ralph stamps a NEW session_id (this is fine — the new ralph state owns the new session)
6. iter N+1 reads state/plan.yaml, picks pending cells, continues
```

The new ralph instance has no memory of prior iterations — but the sweep state files do, so iteration counters reconcile (active.yaml.iteration is the source of truth, ralph just adds 1 to its own counter; sweep iteration log is the canonical history).

## Cancel sequence

`scripts/sweep-cancel.sh`:

1. Read `.claude/ralph-loop.local.md`. Extract `session_id`.
2. If `session_id` matches current session → `rm .claude/ralph-loop.local.md` (ralph stops next Stop event).
3. If `session_id` does NOT match → leave ralph alone. Tell the user "another session owns the ralph loop; cancel it from there."
4. Update `state/active.yaml` → `status: cancelled, cancelled_at: <iso>`.
5. Write a final entry to `iteration-log.md`.
6. Print summary.

## Multi-session safety

The user can have two Claude sessions open in the same project — one running the sweep, one doing other work. The ralph hook's `session_id` field guarantees the Stop hook only fires for the sweep session. The `state/active.yaml.session_id` lets the sweep skill detect "this is a different session attempting cancel/resume" and refuse if needed.

If the sweep session crashes:
- `state/active.yaml` still says `status: active` (we never got to write `cancelled_at`).
- `.claude/ralph-loop.local.md` may or may not still exist (it persists until either `--max-iterations` hits or the user runs `/cancel-ralph`).
- A new session running `/abadge-e2e-sweep resume` reads `active.yaml`, sees `status: active` but `session_id != current`. It proceeds to take ownership: stamps the new session_id, optionally invokes `/ralph-loop:cancel-ralph` first (to clear the stale ralph state), then fires a fresh ralph with the current session.

## Cooperation with `--completion-promise`

The skill always passes `--completion-promise "SWEEP_COMPLETE"` to ralph. The controller ONLY emits `<promise>SWEEP_COMPLETE</promise>` when:
- the saturation gate (`references/saturation-detection.md`) approved it, OR
- the plan-complete check passed.

If the controller is biased to write the promise to escape — that's the failure mode. The integrity check in `references/saturation-detection.md` is the antidote.

## Iteration budget guidance

- Default `--max-iterations 100`. Most sweeps saturate in 30–60 iters with K=4 parallel.
- For a small surface filter (e.g. `--surfaces api,daemon`), use 30.
- For a fresh full sweep against a brand-new feature, 200 is reasonable; stop early via saturation, not via budget.
- `--max-iterations 0` (unlimited) is supported but discouraged. Use only when the user is actively babysitting.

## Race & error matrix

| Race / failure | Outcome | Notes |
|---|---|---|
| Two sessions try `start` simultaneously | First wins (active.yaml exists). Second prints error. | Atomic mkdir on state dir is the lock. |
| User runs `/cancel-ralph` directly (not via skill) | Ralph stops; active.yaml still says active. Next `status` op detects mismatch and warns. | `status` op offers `--reconcile` to fix. |
| Subagent edits state files | Forbidden by contract; no enforcement, but PostToolUse hook can be added later if abuse appears. | Detection: triager will see two new sections with same code; raises alarm. |
| ralph hook fires in wrong session | Skipped via `session_id` check inside hook. | Already handled by ralph-loop. |
| Iteration counter desync | `active.yaml.iteration` is canonical; ralph counter is rebuilt on resume. | Verified at start of each iter. |
| Repro file collision | `sweep-init.sh` uses run-id in path; same run-id can be reused only with `reset --confirm`. | Defensive: append `-v2.ts` if file exists. |

## Why no custom Stop hook?

Two reasons:
1. **Don't reimplement what ralph-loop already does well.** Their hook handles transcript parsing, promise extraction, max-iter enforcement, and session isolation correctly. Adding a second hook stacking on top would create ordering bugs.
2. **Skills shouldn't install hooks.** Hooks belong in plugins (with `${CLAUDE_PLUGIN_ROOT}` resolution, `.claude-plugin/` registration). Project-scoped skills can't and shouldn't install hooks. We delegate cleanly.
