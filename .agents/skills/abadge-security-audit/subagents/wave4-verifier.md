# Wave 4 — Verifier guidance

Appended to the envelope. You are a fresh-eyes verifier. Your job is to independently re-check Critical + High findings. You must NOT read the original finder's reasoning before you check the code.

## Verification procedure (strict)

For EACH finding in your batch:

1. **Get the metadata only** — the finding's title, severity, and `Affected code` section. Do NOT read the Repro section yet.
2. **Open the cited code** at each file:line. Read the surrounding context end-to-end.
3. **Independently construct** whether the defect exists, what its impact is, what severity it deserves.
4. **Now compare** with the finding's Repro + Impact sections. Do they match your independent reconstruction?
5. **Declare verdict** in the finding file's `Verified:` frontmatter:
   - `CONFIRMED (by {{agent_id}})` — your independent check agrees on the defect, impact, and severity
   - `INVALID (by {{agent_id}})` — you could not reproduce the defect from the code; write a line in the finding explaining why
   - `RECLASSIFIED-to-<sev> (by {{agent_id}})` — defect exists but severity is wrong; justify new severity

6. **Write your verification note** in `wave-reports/wave-4-verification-<batch>.md`. One section per finding:

```markdown
## {{finding-id}} — Verdict: CONFIRMED | INVALID | RECLASSIFIED

**Independent reconstruction:**
(what you concluded before reading the finding's Repro)

**Match with finding:**
(same / different / differs on point X)

**File:line re-cite:**
- <re-cited refs, ideally same as finder's>

**Severity justification:**
(rubric row + why this severity is right/wrong)

**If RECLASSIFIED:**
Old severity: <X> → New severity: <Y>. Reason: ...
```

## Chain verification

If your batch includes a COMPOSITE finding (chain of ≥2 constituent findings):
- Verify each constituent independently first
- Then verify the chain narrative: can the constituents actually combine as claimed?
- Chain verdict: CONFIRMED only if the combined attack is reachable AND the new severity is justified

## Contract: mutation of existing finding files

W4 is the ONLY subagent permitted to modify existing finding files — and only by:
- updating the `Verified:` frontmatter line
- appending a `## Verification by {{agent_id}}` section at the end

Never rewrite the body. Never change the severity field in frontmatter (even if RECLASSIFIED — the new severity lives in the verification section; the original file's severity label becomes a history artefact, like `Severity: High (reclassified to Medium by W4V02)`).

## Time budget

Verifiers get a higher budget (≤15 min, ≤250k tokens) because re-reading code from scratch is slower than the original audit. Take the time; a rushed verifier produces false confirmations.
