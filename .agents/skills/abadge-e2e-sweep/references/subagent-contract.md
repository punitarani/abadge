# Subagent Contract

The controller dispatches one subagent per cell (or per related-cell batch) and aggregates JSON reports. This file is the schema and the rules.

## Why a contract

In the prior 224-iter campaign there was no contract. Subagents wrote prose, the controller had to re-parse it every iter, and dedup was guesswork. The fix: every subagent returns a **single JSON object** matching the schema below, written as the **last block** of the subagent's response. The controller extracts it with a regex (`/```json\s*(\{[\s\S]*\})\s*```\s*$/`).

## Return schema (v1)

```json
{
  "schema_version": 1,
  "cell_id": "api.access.reveal-non-opaque.regression",
  "subagent": "api-tester",
  "started_at": "2026-04-22T13:08:42Z",
  "finished_at": "2026-04-22T13:09:14Z",
  "status": "tested" | "blocked" | "skipped",
  "blocked_reason": null,
  "summary": "≤200-char one-liner that ends up in iteration-log.md",
  "findings": [
    {
      "candidate_code": null,
      "title": "decoder requires kind=opaque exactly",
      "severity": "high" | "medium" | "low",
      "surface": "api",
      "evidence": {
        "request": "POST /trpc/access.reveal {\"id\": \"...\"}",
        "response_excerpt": "{\"label\":\"migrated-...\",...}",
        "file_pointer": "packages/trpc/src/server/item-payload.ts:42"
      },
      "minimal_fix_hint": "drop the kind===\"opaque\" gate",
      "repro_artifact": {
        "kind": "ts" | "md",
        "filename_suggestion": "i2-envelope-misdelivery.ts",
        "content": "<full repro file contents>"
      }
    }
  ],
  "verified_working": [
    "access.reveal with kind=opaque round-trips correctly"
  ],
  "next_recommendations": [
    "test access.mount with same payload — likely shares decoder",
    "check items.ownerReveal for same bug"
  ]
}
```

`candidate_code` is null on dispatch — the **triager** assigns the §CODE after dedup. Subagents do not invent codes.

## Single JSON, end of response

The controller looks for the **last** ```json fenced block. The subagent's prose is fine before it; it's discarded. This means subagents can think out loud during their work, then commit a single structured answer at the end.

If a subagent returns:
- no JSON block → controller marks the cell `blocked` with reason "no JSON in subagent response"
- malformed JSON → same
- multiple JSON blocks → controller takes the last one only

## Dispatch envelope (controller → subagent)

The controller constructs every prompt from `subagents/<surface>-prompt.md` plus this envelope:

```
Cell: <cell.id>
Facet: <happy|adversarial|edge|regression>
Scope: <cell scope from surface-map.md>

Environment:
- API base URL: http://localhost:8787
- Web base URL: http://localhost:3000
- Active session cookie: <fresh-fixture or null>
- Active org id: <fresh-fixture>
- Active profile id: <fresh-fixture>

Prior findings to avoid duplicating (one line each):
<grep of issues.md for this surface, max 30 lines>

Refers-to (regression cells only): <§CODE list>

Tooling available to you:
- Bash, Read, Grep, Glob, Edit, Write
- Playwright MCP (only for cells flagged requires: playwright)
- Chrome DevTools MCP (alternative to Playwright)
- The dev stack at the URLs above is live; do not start/stop it
- The dev DB is local Postgres (ok to mutate; do not drop)

Forbidden:
- Touching git
- Editing the abadge codebase except inside `state/repros/`
- Pushing to remote
- Calling advisor() (controller does that)
- Running other subagents
- Modifying state/* files (controller writes; you return JSON)
- Posting to external services
- Reading the worktree's TESTING.md or scripts/repro/ (those are prior-campaign noise; use ONLY the prior-findings list above)

Return: A single JSON object matching the contract at
references/subagent-contract.md (schema_version 1).
```

That envelope is identical across all surface subagents — the surface-specific guidance lives in the surface's prompt template.

## Tester subagent operating rules

1. **Stay in scope.** If a finding is outside the cell's scope, mention it in `next_recommendations` rather than chasing it. The controller will plan a future cell.
2. **Live-confirm every finding.** A finding that is "code-read only" must be flagged as `severity: low` and explicitly note `evidence.request: null, evidence.response_excerpt: null, file_pointer: <path:line>` so the triager knows it's static analysis.
3. **One repro per finding.** The repro file must run cold (env vars in the header comment, no implicit state).
4. **Don't re-flag known issues** unless something changed. If `prior findings` already lists the issue, skip it; the regression facet exists for explicit re-verification.
5. **Time-box.** ≤6 minutes of wall time per dispatch (≈the practical limit before context churn dominates). If the cell is too large, return `status: blocked, blocked_reason: "cell too large; recommend splitting into X and Y"`.

## Triager subagent

Dispatched after every parallel batch. Inputs:

```
{
  "new_findings": [<all findings from this iter's subagents>],
  "issues_md_tail": "<last 200 lines of state/issues.md>",
  "iter": 47
}
```

Returns:

```json
{
  "decisions": [
    {
      "candidate_index": 0,
      "verdict": "new" | "duplicate" | "amend",
      "assigned_code": "§I2",
      "duplicate_of": null,            // §CODE if verdict=duplicate
      "amend_note": null,              // ≤200 chars to append under existing §CODE
      "rationale": "..."
    }
  ],
  "next_codes_used": ["§AUDIT5"],
  "summary": "1 new (§AUDIT5), 2 duplicates (§I2 ×2), 0 amendments"
}
```

The triager owns the §CODE namespace. It picks the next free code in the surface-letter convention (`§I` for items, `§AG` for agents, `§W` for web, etc.). It is the single source of truth for what counts as "the same bug".

## Reporter subagent

Used by the `report` op only. Inputs:

```
{
  "active": <state/active.yaml>,
  "plan": <state/plan.yaml>,
  "progress": <state/progress.yaml>,
  "issues_md": <state/issues.md full>,
  "checkpoints": <state/checkpoints.md>,
  "iteration_log_tail": "<last 100 iterations>"
}
```

Returns markdown rendered into `state/REPORT.md`. Format mirrors the prior `TESTING.md`: Final counts → Headline regression chains (auto-detected from issues.md by tracing `refers_to` graphs) → Fix Priority roadmap → Surface assessment table → Iteration log tail.

## Concurrency

The controller dispatches up to `parallel_limit` (default 4) testers per iter. **Never** dispatch two subagents that touch the same plan-cell or the same external resource (e.g. two `web.*` cells racing on the same browser session). The plan generator pre-marks cells with `parallelizable: false` when a shared resource constraint exists; the controller respects that flag.

Triager and reporter are always serial — never parallel with anything else.

## Failure handling

| Subagent return | Controller action |
|---|---|
| `status: tested` with findings | Write findings via triager; mark cell `done` |
| `status: tested` no findings | Mark cell `done`; increment `consecutive_zero_finding_iters` |
| `status: blocked` | Mark cell `blocked`; record `blocked_reason` in plan; do NOT re-dispatch this iter |
| Malformed JSON | Mark cell `blocked` with reason "schema violation"; log to checkpoints.md |
| Subagent crash / no return | Mark cell back to `pending`; wait for next iter (max 3 retries before `blocked`) |

## Versioning

`schema_version: 1` is the current contract. If you change the schema:
1. Bump to 2.
2. Add a translation step in the controller for old fields.
3. Document the diff at the bottom of this file.
