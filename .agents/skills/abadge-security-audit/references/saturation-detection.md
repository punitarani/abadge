# Saturation Detection

The security audit has a **concrete completion criterion** (unlike an E2E sweep): every cell of plan.yaml is done AND every Critical/High finding has been verified. But saturation still matters — subagents can run out of genuine attack surface well before the last plan cell, and we shouldn't burn iterations re-testing the same things.

## Honest exits (three paths)

1. **Plan-complete + verified.** All 40+ cells in `plan.yaml` have `status: done` AND every Critical/High finding has `Verified: CONFIRMED|INVALID|RECLASSIFIED`. The skill emits `<promise>AUDIT_COMPLETE</promise>` and writes the final report.

2. **Saturated.** K consecutive iterations produced zero new findings AND the current wave is on its last cell. Advisor agrees. The skill emits the promise; the final report documents which cells were skipped and why.

3. **Iteration budget hit.** `--max-iterations` reached. Ralph exits; controller writes `status: cancelled` and tells the user to resume. Not an honest completion.

## Counter mechanics

`progress.yaml.consecutive_zero_finding_iters`:
- increments when an iteration's triager reports zero `verdict: new` decisions (amendments and duplicates don't reset — they're not new signal)
- resets to 0 the moment a new finding is minted

## The advisor query template

When counter hits threshold (default 4), controller calls `advisor()` with:

```
Security audit run <run_id>, iter N, wave <W>.

Findings so far:
- <C>/<H>/<M>/<L>/<I> by severity
- <verified>/<total Crit+High> Crit/High verified

Current wave <W> status:
- cells done: X / Y
- cells pending: <list of pending cell IDs>
- cells blocked: <list>

Last 4 iters produced 0 new findings. Saturation threshold hit.

Question 1: Are the pending cells in this wave likely to produce new findings, or is this wave saturated?
Question 2: Do any unfinished surfaces in earlier waves warrant reopening (e.g., we found something in W3 that points back to a W1 gap)?
Question 3: If saturated AND plan-complete, should we emit AUDIT_COMPLETE, or are there coverage gaps that would make completion dishonest?

Return:
- "CONTINUE: <reason + prioritisation>"
- "WAVE_COMPLETE_NEXT: <any wave-report notes to capture before advancing>"
- "SATURATED: <final report notes; coverage gaps to document>"

Be honest. Prior audits that declared completion with unverified Crit/Highs produced false confidence.
```

## Wave-transition logic

A wave completes when every cell in that wave is `done` or `blocked`. On transition:
1. Controller dispatches a brief wave-summary subagent (lightweight — reads all notes files for that wave + all findings filed by its cells) to write `wave-reports/wave-<N>.md`.
2. Controller flips `current_wave += 1` in `active.yaml`.
3. For W4 entry: controller generates verifier cells from the Critical/High findings discovered in W1-W3, batching them by theme. Verifier cells are `parallelizable: false` — they run serial so context stays clean.

## Integrity gate before AUDIT_COMPLETE

Before emitting the promise, controller verifies:

1. All plan.yaml cells have `status ∈ {done, blocked}`
2. `findings_pending_verify == 0`
3. Every Critical finding has a W4 verifier stamp
4. Every High finding has a W4 verifier stamp
5. `99-FINAL-REPORT.md` AND `100-PRODUCTION-CHECKLIST.md` exist and reference every finding
6. No subagent returned `contract violation` in the last wave

If any fails → log the specific failure to `iteration-log.md`, do NOT emit promise, continue loop.

## False-saturation guards

Audits have a specific failure mode: a subagent exhausts the obvious issues and then "finds nothing" when actually they ran out of ideas. Guards:

- Subagents with zero findings AND `tried_negative` list <3 items trigger a controller re-dispatch with an expanded hunting catalogue (drawn from `threat-model-recap.md`)
- Three consecutive waves with <1 new Crit/High and ≥80% cells marked `done` → trigger a paranoid re-dispatch of 2 random cells with a different auditor identity (fresh context, different prompt angle)
- Saturation advisor always gets to see the tried_negative lists — if they're thin, advisor should say CONTINUE even if the counter hit threshold

## Forbidden shortcut

The controller is NEVER permitted to emit `<promise>AUDIT_COMPLETE</promise>` on grounds of "I think we've covered enough" without the integrity gate passing. The completion promise is a commitment; lying to exit is the exact failure mode this skill guards against.
