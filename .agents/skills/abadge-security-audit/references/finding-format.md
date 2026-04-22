# Finding File Format

Every confirmed finding is ONE `.md` file under `docs/security-audit/findings/<severity>/<ID>-NNN-<slug>.md` where `<severity>` is `critical|high|medium|low|informational` and `<ID>` is the subagent's prefix (W1S01, W2T07, W3P04, W4V02, etc.).

Format derived from the prior audit (`docs/security-audit/01-METHODOLOGY.md`).

## Template

```markdown
# <ID>-NNN: <short title>

**Severity:** <Critical | High | Medium | Low | Informational>
**Surface:** <api | web | sdk | cli | mcp | daemon | crypto | auth | db | trpc | env | repo>
**CWE:** <CWE-XXX or multiple, if applicable>
**Status:** <new | confirmed | duplicate-of-<ID> | invalid | regression-of-<prior-ID> | fixed>
**Verified:** <pending | CONFIRMED (by W4V#) | INVALID (by W4V#) | RECLASSIFIED-to-<sev> (by W4V#)>

## Summary

One paragraph describing the issue and its impact at the system level. Keep ≤5 sentences.

## Severity justification

Cite the row from `04-SEVERITY-RUBRIC.md` that applies. One sentence.

## Affected code

- `path/to/file.ts:LINE` — what the code does at this line
- `path/to/other.ts:LINE-LINE` — related path if this finding spans files

File:line citations are MANDATORY. Findings without them are auto-downgraded to Informational.

## Repro / exploit path

Numbered steps that reconstruct the defect:
1. Preconditions (what the attacker or environment needs)
2. Exact inputs (request shape, payload, env)
3. Observed code path (cite file:line at each hop)
4. Outcome (what the attacker gains, what's returned, what's logged)

For Wave 3 pen-tests, this is a static exploit path (no live exploitation). Cite the code hops and state what the attacker would observe if the exploit were attempted.

## Impact

What an attacker gains. Be concrete:
- ❌ "information disclosure"
- ✅ "data exfiltration of all server_managed items belonging to org X via authenticated member role"

## Preconditions / likelihood

Who can trigger this, what access they need first, how easy is discovery.

## Recommended fix

Smallest change that closes the defect without breaking invariants. Prefer "guard at line N" over "redesign the module".

## Verification checklist

For the Wave 4 verifier (if this is C or H):
- [ ] Re-read code at cited file:line without referring to the Repro section
- [ ] Attempt to reconstruct the exploit path independently
- [ ] Confirm each precondition is reachable
- [ ] State CONFIRMED / INVALID / RECLASSIFIED with justification

---

**Found by:** wave-<N> / <subagent-ID>
**Filed at:** <ISO timestamp>
**Duplicate of / amends:** <ID or none>
```

## Finding ID scheme

```
W1S01-001   = Wave 1, Surface 01 (API), finding 1 in its file
W2T07-003   = Wave 2, Threat class 07 (Races), finding 3 in its file
W3P04-001   = Wave 3, Pen-test 04 (MCP leak), finding 1
W4V02-001   = Wave 4, Verifier 02, new finding discovered during verification
COMPOSITE-001 = cross-finding chain, written by the triager when ≥2 findings chain
```

Numbering is **local to the subagent's prefix**. Subagents start at 001. The triager never renumbers; when it finds a dup it writes the dedup note under the original without touching the newcomer's ID (then discards the newcomer's file if filing was attempted).

## Composite / chain findings

When the triager detects that ≥2 findings chain into a more dangerous attack, it writes a COMPOSITE file under `findings/critical/` (usually) with:
- the chain narrative (Finding A + Finding B + Finding C → new attacker goal)
- references to each constituent finding
- a new severity derived from the combined impact

Example from prior audit: `COMPOSITE-001-cross-uid-daemon-rce-chain.md` combined socket-perms TOCTOU + exec RPC no-auth into a latent Critical.

## Negative results

When a subagent tried to find an issue and did not:
- do NOT file a finding
- DO record it in the notes file under "Tried X, found nothing because Y"

This prevents the next wave from re-testing the same surface with the same technique.
