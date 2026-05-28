# Dedup Protocol

Owner: triager subagent. Security findings have strong dedup signals (CWE + file:line). Aggressive dedup keeps the findings list trustworthy.

## Signal hierarchy

For each candidate finding, the triager checks in order:

1. **Exact file:line match** against existing findings → duplicate
2. **Same CWE + same file (±20 lines)** → duplicate
3. **Same CWE + same surface + same function name** → duplicate
4. **Title cosine similarity ≥0.85** against existing titles → likely duplicate (flag for human if severity differs)
5. **Prior-review ✅-Fixed row match AND fix still present** → `Verified Fixed`, not a finding
6. **Otherwise** → new finding

## Verdicts

- `new` — mint new ID; leave file in place; append to plan.yaml `findings_filed` for that cell
- `duplicate-of-<ID>` — append a line `**Re-confirmed iter N from <agent-id>**` under the existing section AND delete the duplicate file (if the tester wrote it)
- `amend-<ID>` — same root cause, additional evidence. Append the new evidence under the existing section under a `### Amendment from <agent-id> iter N` heading. Delete the duplicate file.
- `regression-of-<prior-id>` — the prior-review row said ✅ Fixed but the fix is no longer in place. File as new, with Status field `regression-of-<prior-id>` + severity same as the original prior finding.

## Severity adjustments the triager owns

- Claimed C/H without file:line citation → demote to Medium with a note
- Medium+ without severity rubric citation → demote to Informational
- Static-only evidence claimed as Critical with no exploit chain → demote to Medium
- W3 pen-test verdict NEG with a finding filed anyway → mark the finding Informational (they found something minor, not the thing they were hunting)

## Composite / chain detection

After each wave, the triager scans the current findings for chains. A chain is ≥2 findings that, when combined, allow an attacker to reach a goal neither reaches alone.

Example (from prior audit): W1S6-001 (socket-perms-toctou) + W1S6-003 (exec-rpcs-no-auth) → COMPOSITE-001 (cross-uid-daemon-rce-chain) at Critical, even though each component alone was High.

The triager writes COMPOSITE-NNN files under `findings/critical/` (or the appropriate severity of the combined attack) with:
- Chain narrative
- References to each constituent finding
- New severity derived from combined impact
- Added to the Wave 4 verify list

## Cap on new codes per iteration

If the triager would mint >5 new codes in a single iter, it returns `verdict: blocked` — the controller then splits the offending subagent's scope.

## Attribution preservation

Every finding and every amendment retains its `**Found by:** wave-N / <agent-id>` trailer. Chain findings credit each constituent.

## Quality gate for duplicates

A duplicate detection is only valid when the triager can cite the existing finding's file:line. "Feels similar" is not enough; if unsure, mint new and flag for human triage.
