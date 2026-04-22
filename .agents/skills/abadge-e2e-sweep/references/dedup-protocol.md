# Dedup Protocol

Owner: triager subagent. Goal: keep `state/issues.md` ≤200 distinct codes, never re-mint a code for a bug that's already known.

## The signal hierarchy

When deciding whether two findings are the same bug, the triager checks signals in order. First match wins.

1. **Same `evidence.file_pointer`** (path + line ±5) → same bug.
2. **Same response shape signature** — the `evidence.response_excerpt` is JSON-canonicalised (sort keys, strip values >8 chars to type-tags) and hashed. Same hash → same bug.
3. **Same request endpoint + same error code** → same bug.
4. **Title cosine similarity ≥ 0.85** against an existing title (compare `title` against existing §CODE titles; the triager just eyeballs this — no embeddings).
5. **Otherwise** → new bug.

## §CODE assignment

The triager owns the code namespace. Conventions:
- One letter per surface family: `S` security, `I` items, `AG` agents, `OWN` ownership, `P` permissions, `W` web, `ON` onboarding, `O` orgs, `M` mcp, `R` rate-limit, `A` audit, `AU` auth, `F` fields, `RED` redaction, `LP` payload, `CLI`, `SDK`, `DOC`, `ENV` envelope, `TM` threat-model, `SEC` security generic, `DMN` daemon, `CRYP` crypto, `DB`, `SCHEMA`, `STATIC`, `CORS`, `HTTP`.
- Numbers monotonically increase per family.
- Suffix `b`, `c` for sub-issues that are tightly related but distinct (e.g. `§ON5b` discovered as a knock-on from §ON5).

## Verdict types

- **new** — mint a fresh §CODE; create a new section in `issues.md`; write the repro under `state/repros/<code>-<short>.<ext>`.
- **duplicate** — do not mint; under the existing section append `**Re-confirmed iter <N> from cell <id>**`. Drop the candidate's repro (don't double-store).
- **amend** — same bug, but the candidate adds new evidence (different code path, new bypass). Append `**Amended iter <N>:** <amend_note>` and store the new repro alongside.

## Severity rubric

| Severity | Trigger |
|---|---|
| **🟥 high** | One of: data loss/corruption, plaintext secret leak, auth bypass, prod-only stack/info disclosure, capability matrix violation, audit log integrity violation, account orphan/lockout. |
| **🟧 medium** | Silent UX failure that costs trust (modal 400 with no message, dead button), DoS vector that requires effort, error-envelope inconsistency, docs drift on security claims, cross-agent or cross-org leakage of metadata (not secrets). |
| **🟨 low** | Cosmetic, missing pagination on small lists, lint warnings, accessibility nits, naming inconsistency, low-impact docs drift, observation-only findings (no live repro). |

The triager assigns severity using only this rubric — never escalates based on subagent's own claim. If the subagent flagged `high` but evidence is static-analysis only, the triager downgrades to `low`.

## Headline regression chain detection

After each triage, the triager scans for new chains. A chain is two-or-more high findings with overlapping `refers_to` or shared user-flow keywords (`onboarding`, `signup`, `invite`, `vault unlock`). When a new chain forms, the triager appends to `state/checkpoints.md`:

```
### Chain detected iter 47

§ON5 → §ON5b → §W2 → §I2

Combined effect: a fresh signup who picks server-managed cannot use the product.

Recommend bumping all 4 to fix-priority 1.
```

The controller then re-prioritises matching plan cells.

## Stop conditions for the triager

If the triager would mint more than 5 new codes in a single iteration, it returns `verdict: blocked` instead — that means a tester subagent's scope was too broad. The controller then splits the offending cell into smaller cells and re-dispatches next iter.
