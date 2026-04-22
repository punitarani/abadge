# Subagent Contract

Every dispatched subagent receives an envelope (`subagents/_envelope.md` + a wave-specific template). The envelope enforces read-only, output discipline, and the return format.

## Return format (≤30 lines, one JSON block at the end)

Subagents may think aloud in prose. Their **final content block** must be a single JSON object:

```json
{
  "schema_version": 1,
  "agent_id": "W1S05",
  "wave": 1,
  "scope": "packages/mcp — tools, redaction, capability boundary",
  "started_at": "2026-04-22T11:45:30Z",
  "finished_at": "2026-04-22T11:52:14Z",
  "status": "completed" | "blocked" | "partial",
  "blocked_reason": null,
  "notes_path": "docs/security-audit/notes/mcp.md",
  "findings": [
    {"id": "W1S05-001", "severity": "informational", "title": "redaction substring-only", "path": "docs/security-audit/findings/informational/W1S05-001-redaction-substring-only.md"},
    {"id": "W1S05-002", "severity": "low", "title": "mcp legacy auth token doc drift", "path": "docs/security-audit/findings/low/W1S05-002-mcp-legacy-auth-token-doc-drift.md"}
  ],
  "verified_fixed": ["<prior-id>", "..."],
  "tried_negative": [
    "Tried: bearer plugin fall-through via capitalized scheme. Found: case-sensitive but plugin normalizes. No finding.",
    "Tried: get_audit cross-agent leak. Found: duplicate of W1S09-002. Referenced."
  ],
  "verdict": "one-sentence overall"
}
```

## What counts as completed

- `completed` — scope fully covered; notes file written; all findings filed
- `partial` — scope mostly covered but one or more sub-scopes hit preconditions that can't be met (e.g., can't read a file due to permissions); notes state what was skipped and why
- `blocked` — subagent cannot make meaningful progress; controller marks the cell blocked and moves on

## Mandatory preconditions subagents enforce

Before writing any file, the subagent confirms:

1. `docs/security-audit/` exists (bail if not)
2. Target path is inside `docs/security-audit/` (no writes outside)
3. For findings: severity directory exists; filename matches `<ID>-NNN-<slug>.md`
4. For notes: filename matches the scope path declared in the dispatch envelope

If any precondition fails → return `status: blocked, blocked_reason: <specific>` without writing anything.

## Inputs the controller provides (envelope filled per-dispatch)

- `agent_id` — the prefix (W1S01, W2T07, W3P04, etc.)
- `wave` — 1, 2, 3, or 4
- `scope` — the single surface / threat class / pen-test scenario
- `notes_path` — pre-determined path this subagent writes to
- `findings_prefix` — directory where finding files go
- `prior_wave_inputs` — paths to notes/findings from earlier waves (empty for W1)
- `authoritative_docs` — absolute paths to AGENTS.md, SECURITY.md, THREAT_MODEL.md, CAPABILITY_MATRIX.md, the threat-model recap, and the severity rubric
- `prior_review_path` — `docs/reviews/2026-04-14-full-stack-review.md` (resolution-status cross-reference)

## Forbidden actions (repeat-for-emphasis)

- `Edit` on any file (use `Write` only inside `docs/security-audit/`)
- Any Bash command that writes / appends / mutates (`echo >`, `tee`, `sed -i`, etc.)
- `bun run build/dev/test`, `npm install`, `git commit/push/checkout -B`
- Starting any server, daemon, or background process
- `advisor()` — the controller handles advisor calls at checkpoint intervals
- Dispatching additional subagents

Violation → subagent's output is discarded and the cell is marked blocked with reason "contract violation: <what>". The audit does not accept tainted output.

## Time / context budget

- Target: ≤8 min wall time, ≤150k tokens per subagent.
- If scope is larger, return `status: partial` with specific splits the controller should dispatch separately.
- Wave 4 verifiers have a higher budget (up to ≤15 min) because they re-read the code from scratch.

## Negative-result discipline

A subagent that returns zero findings is VALID if the `tried_negative` list is non-empty and substantive. It is a RED FLAG if a subagent returns zero findings AND zero negative results — that means they didn't actually investigate. The controller logs this and re-dispatches after splitting the scope.

## Versioning

`schema_version: 1` is the current contract. Raise only on breaking changes to the JSON shape.
