# Saturation Detection

The single most important lesson from the prior 224-iteration campaign: **the loop has no honest exit condition unless we install one**. ralph-loop's `--completion-promise` only fires when the controller writes the magic string, and the controller is biased to keep working. So the saturation gate is the controller's discipline, not ralph's enforcement.

## Two ways the sweep ends honestly

1. **Plan-complete.** Every cell in `plan.yaml` has `tested_at: <iso>` AND there are zero open `severity: high` issues. The matrix has been exhausted, the critical bugs are documented, the testing job is done.
2. **Saturated.** The next K iterations would predictably produce no new findings — value/iter has converged to zero. Stopping early is honest if and only if `advisor()` agrees.

There is **no third way**. "Iteration limit hit" is *not* an honest exit — it's a guardrail against runaway, not a completion signal. When `--max-iterations` triggers, ralph removes its state file and the controller writes `status: cancelled` to active.yaml.

## The saturation counter

`progress.yaml.consecutive_zero_finding_iters` is incremented at the end of every iteration that produces zero **new** findings (duplicates and amendments do not reset it; they continue the streak — those don't actually move the needle). It resets to 0 the moment a new §CODE is minted.

`saturation_threshold` (default 5) is the streak length that triggers the advisor query. The threshold is configurable per-run in `active.yaml`.

## The advisor query

When `consecutive_zero_finding_iters >= saturation_threshold`, the controller does not exit. It calls `advisor()` with this prompt template:

```
Sweep run <run_id>, iter N.

Coverage: <cells_done>/<cells_total> done; <pending> pending across surfaces:
<per-surface table from progress.yaml>

Open issues: <high>/<med>/<low>

Last 5 iter summaries (from iteration-log.md):
<grep tail>

The last 5 iters produced 0 new findings. Saturation threshold hit.

Question 1: Are the remaining pending cells likely to produce new findings, or is this campaign saturated?

Question 2: If saturated, are there any unaddressed surfaces from references/surface-map.md that the plan never expanded? Coverage gaps are different from saturation.

Return either:
- "CONTINUE: <one-line reason and which cells/surfaces to prioritize>"
- "PIVOT: <one-line reason; controller should call /abadge-e2e-sweep status, then human will decide>"
- "SATURATED: <one-line summary>"

Be honest. False completion ended the prior campaign at iter 113 of an effective limit.
```

The advisor gets the controller's full transcript implicitly (via the advisor tool's design). Three responses:

| Response | Controller action |
|---|---|
| `CONTINUE: …` | reset counter to 0, apply the prioritisation hint, continue loop |
| `PIVOT: …` | write a checkpoint entry, output a status-style summary, **stay in loop** but prompt the user (the loop will re-fire; user decides next message). |
| `SATURATED: …` | write checkpoint entry, set `active.yaml.status: saturated`, write `<promise>SWEEP_COMPLETE</promise>` to exit ralph |

## The integrity check before SWEEP_COMPLETE

Before emitting the promise, regardless of which trigger fired, the controller verifies:

```
1. progress.yaml.cells_done + cells_in_progress + cells_pending == cells_total
2. progress.yaml.cells_done >= 0.6 * cells_total           (or advisor SATURATED)
3. open severity:high count from issues.md == 0            (or advisor SATURATED)
4. iteration_log.md tail matches active.yaml.iteration
5. no `status: in_progress` cells (anything in flight)
```

If any check fails, the controller writes a checkpoint entry explaining the discrepancy and continues — **does not** emit the promise.

## False-finding detection (the inverse hazard)

Subagents under loop pressure can hallucinate findings to feel productive. The triager guards against this:
- A finding without live `evidence.request` + `evidence.response_excerpt` is auto-downgraded to severity `low` and tagged `(static-analysis only)` in issues.md.
- Three consecutive iters where ≥80% of new findings are static-analysis-only triggers an advisor query asking "are subagents grasping at straws?". Common answer: yes, the next surface needs a different test approach.

## Counter is part of state

Both `consecutive_zero_finding_iters` and `last_advisor_iter` live in `progress.yaml` so they survive session crash + resume. After a crash, the resume reads them back; saturation logic stays consistent.

## Manual override

The user can write `force_continue: true` into `active.yaml` to suppress saturation triggers for one iter (they pop it off after the next iter). Useful when the user knows there's a specific surface they want exhausted before the loop honestly exits.

The opposite — `force_complete: true` — is rejected. We do not provide an "exit lying" lever.
