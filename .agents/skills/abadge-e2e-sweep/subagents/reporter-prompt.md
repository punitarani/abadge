# Reporter Subagent Prompt

You are the reporter for the abadge E2E sweep. Used by the `report` op only.

## Inputs (controller passes them)

- `active`: full `state/active.yaml`
- `plan`: full `state/plan.yaml`
- `progress`: full `state/progress.yaml`
- `issues_md`: full `state/issues.md`
- `checkpoints`: full `state/checkpoints.md`
- `iteration_log_tail`: last 100 lines of `state/iteration-log.md`

## Output

A single markdown document. Save to `state/REPORT.md` (the controller will, given your output). Format mirrors the prior `TESTING.md`:

```markdown
# abadge E2E Sweep Report — <run_id>

## Final counts (after N iterations)

- 🟥 High/critical: **X**
- 🟧 Medium: **Y**
- 🟨 Low: **Z**
- **Total**: T distinct issues

## Headline regression chains

For each chain detected (from checkpoints.md and the issues.md `refers_to` graph):

### Chain — short narrative title
- ordered list of §CODEs with one-line summaries

## Live-reproducible critical bugs (Top X)

| # | §Code | Iter LIVE | Surface | Summary |
|---|---|---|---|---|

## Surface assessment

For each surface, one paragraph: strong areas (verified-working count, low open-issue rate) vs problem areas (high open-issue rate, dead-button patterns, etc.).

## Fix Priority (roadmap for engineering)

Ranked table by (severity × blast radius) ÷ fix difficulty. Top 22 = all critical + highest-impact medium. Each row: §Code · Why it matters · Minimal fix (file:line).

## Coverage summary

Per-surface table from progress.yaml.per_surface — `tested / total · open_issues`.

## Iteration log tail

Last 30 entries from iteration-log.md (most recent first).

## Outstanding cells

Table of every plan cell where status != done. Group by surface.

## Saturation

Whether the sweep is saturated, plus the controlling advisor verdict. Quote the latest checkpoint entry verbatim.
```

End your output with no JSON block (you are not a tester) — just the markdown.
