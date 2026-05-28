# Severity Rubric

A finding's severity is **impact × exploitability**, rated one of five levels. Every finding MUST cite the rubric row that justifies its rating in the "Severity justification" section. Findings without that citation are auto-downgraded to Informational by the triager.

Based on the prior audit's proven rubric (`docs/security-audit/04-SEVERITY-RUBRIC.md`).

## Critical

At least one of:
- Direct exposure of plaintext secrets without authentication
- Bypass of zero-knowledge invariant (server gains key material it should not have)
- Cross-org or cross-tenant data access
- Authentication bypass (no credentials → privileged action)
- Remote code execution on the API worker or daemon

Exploitability: any unauthenticated or low-privilege actor can trigger within minutes.

## High

At least one of:
- Authorization bypass within an org (member → admin/owner; agent → beyond capability)
- Plaintext leakage via logs / error envelopes / audit-log meta accessible to non-owners
- Crypto weakness that meaningfully reduces attacker effort (nonce reuse, weak KDF, predictable random, missing AAD on AEAD that should bind context)
- Audit-log tamper or omission (silent access)
- Persistent secret on disk that threat model says must not persist (e.g., master password cache)

Exploitability: requires authentication but otherwise straightforward.

## Medium

At least one of:
- Information disclosure that informs but does not directly grant capability (timing oracle, enumeration of valid IDs)
- Rate-limit gap that enables targeted brute force given hours
- Missing security header that weakens defense in depth (CSP, HSTS, X-Content-Type-Options) on a sensitive surface
- Capability or permission edge case contrary to product intent but not explicitly forbidden in docs

Exploitability: realistic for a determined attacker with auth.

## Low

At least one of:
- Defense-in-depth gap with low realistic impact
- Hardening opportunity (constant-time compare on a non-security-critical op)
- Minor input validation gap with no downstream defect
- Doc-vs-code drift that could mislead an integrator
- Cleanup / resource-handling weakness that isn't attacker-reachable

Exploitability: edge case or compounded with another flaw.

## Informational

- Observation / suggestion / future-hardening note
- Documented limitation reaffirmed
- Style or hygiene issue with no security impact
- Verified-fixed item from prior review (no new finding filed; recorded in notes)

## Combining factors

When multiple factors apply → take the **higher** severity. A finding is at most one severity above the highest single factor that applies (so "two Lows" do not become a Medium just by counting).

## Tiebreakers

- Prefer **higher** severity if the issue affects the encryption boundary — it always wins.
- Prefer **higher** severity if there is no compensating control.
- Prefer **lower** severity if exploitation requires cooperation from a privileged user (org owner) or local root.

## Triager auto-adjustments

The triager subagent applies these without asking:

| Claimed severity | Adjustment |
|---|---|
| Critical/High without live exploit chain OR static code path | downgrade to Medium with note "static observation, no path to goal" |
| Medium+ without file:line citation | downgrade to Informational |
| Any severity where Wave 1 already noted "tried X, found nothing" for the same issue | skip (already covered) |
| Any severity flagged against a file with `docs/reviews/2026-04-14-full-stack-review.md` ✅ Fixed row AND the fix is still in place | reclassify as "Verified Fixed" (not a finding) |

## Critical/High gate on audit completion

The audit is not complete until EVERY Critical and EVERY High has a Wave 4 verifier stamp of `CONFIRMED`, `INVALID`, or `RECLASSIFIED: <new severity>`. This is the key honesty gate — critical findings cannot linger unverified.
