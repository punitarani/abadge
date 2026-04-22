# The Four-Wave Model

Adapted from the prior audit methodology (`feat/sleepy-pascal-324a1c`, session `ff9f5b8d`) which produced 139 findings across 4 waves.

## Philosophy

A naive "find all bugs" audit produces noise — every subagent independently re-discovers the same things from different angles. The wave model imposes **progressive scope constraints** so each wave's outputs inform the next, and no wave repeats work the previous wave already did.

```
W1: What IS there?          (surface inventory)
W2: What could go wrong?    (threat classes applied to W1's map)
W3: How would an attacker?  (static exploit paths using W1+W2)
W4: Is it really true?      (independent re-verify of C/H findings)
```

Each wave has a **gate** that must close before the next begins. No W2 agents dispatch until every W1 notes file is on disk. This prevents later-wave agents from racing ahead without the context they depend on.

## Wave 1 — Surface recon (11 agents)

One auditor per package / layer. Goal: inventory + trust-boundary map + confirm/refute every AGENTS.md invariant in that surface.

| ID | Scope | Notes file |
|---|---|---|
| W1S01 | apps/api — Hono routes, middleware, CORS, rate limit | notes/api.md |
| W1S02 | apps/web — Next.js auth flows, client crypto bridge | notes/web.md |
| W1S03 | packages/sdk — AbadgeUserClient, AbadgeAgentClient | notes/sdk.md |
| W1S04 | packages/cli — commands, config, daemon client | notes/cli.md |
| W1S05 | packages/mcp — tools, redaction, capability boundary | notes/mcp.md |
| W1S06 | packages/daemon — Unix socket, vault state, subprocess injection | notes/daemon.md |
| W1S07 | packages/crypto — KDF, key wrapping, AES-GCM, Ed25519 | notes/crypto.md |
| W1S08 | packages/auth — Better Auth integration | notes/auth.md |
| W1S09 | packages/db + packages/trpc — schema + router | notes/db-trpc.md |
| W1S10 | repo hygiene — CI, package.json, supply chain | notes/repo-hygiene.md |
| W1S11 | packages/env — env validation completeness | notes/env-validation.md |

**Wave 1 gate:** every notes file exists (empty is OK; explicit "no findings" counts). Gate closed when `notes/` has ≥11 files listed in plan.yaml.

## Wave 2 — Threat-class deep-dive (12 agents)

One auditor per threat class. Uses W1 notes as input — each W2 agent reads the relevant W1 notes before starting. This is how W2 avoids rediscovering W1 findings.

| ID | Threat class | Notes file |
|---|---|---|
| W2T01 | Authentication boundary fall-through | notes/threat-authn.md |
| W2T02 | Authorization & capability enforcement | notes/threat-authz.md |
| W2T03 | Cryptographic correctness (nonces, AEAD AAD, modes) | notes/threat-crypto.md |
| W2T04 | Session token lifecycle (mint, refresh, revoke) | notes/threat-sessions.md |
| W2T05 | Input validation & deserialization | notes/threat-input.md |
| W2T06 | Information disclosure (errors, enumeration) | notes/threat-disclosure.md |
| W2T07 | Race conditions / TOCTOU | notes/threat-races.md |
| W2T08 | Secret leakage (logs, errors, MCP outputs) | notes/threat-leakage.md |
| W2T09 | Rate limiting & DoS | notes/threat-dos.md |
| W2T10 | Supply chain & dependencies | notes/threat-supply.md |
| W2T11 | Headers, cookies, CORS, CSP | notes/threat-headers.md |
| W2T12 | Audit log integrity | notes/threat-audit.md |

**Wave 2 gate:** every W2 notes file exists AND W1 is complete.

## Wave 3 — Pen tests (12 agents)

Static exploit-path construction. Each agent takes a single adversarial scenario and reasons end-to-end: what preconditions does the attacker need, what code path leads to the goal, what mitigating controls exist, can they be bypassed?

No live exploitation. Output is a `.md` in `pen-tests/` with:
- Attacker model (capabilities, access level)
- Target (what they're trying to achieve)
- Code trace (file:line citations)
- Preconditions
- Observed effect (what returns, what's logged)
- Mitigations (compensating controls that hold)
- Verdict: NEG (attack fails) / POS (attack succeeds) / PARTIAL (attack succeeds under specific conditions)

| ID | Scenario | Result file |
|---|---|---|
| W3P01 | Forge `abs_` session token without private key | pen-tests/01-forge-session-token.md |
| W3P02 | tRPC input crafting to bypass permission check | pen-tests/02-bypass-permission.md |
| W3P03 | Cross-org IDOR on items / agents / audit | pen-tests/03-cross-org-idor.md |
| W3P04 | Get MCP to leak plaintext to LLM | pen-tests/04-mcp-leak.md |
| W3P05 | Replay daemon RPC after `vault.lock` | pen-tests/05-daemon-replay.md |
| W3P06 | Schema-level mode confusion (ZK ↔ SM) | pen-tests/06-mode-confusion.md |
| W3P07 | Tamper with audit log to hide an access | pen-tests/07-audit-tamper.md |
| W3P08 | Org member → owner privilege escalation | pen-tests/08-rbac-escalation.md |
| W3P09 | Steal in-flight `abe_` / `abc_` token | pen-tests/09-token-theft.md |
| W3P10 | Smuggle malicious payload past Effect Schema | pen-tests/10-payload-smuggle.md |
| W3P11 | DoS via expensive crypto / payload bombs | pen-tests/11-dos.md |
| W3P12 | Daemon socket squat / IPC abuse | pen-tests/12-daemon-squat.md |

**Wave 3 gate:** every pen-test file exists AND W2 is complete.

## Wave 4 — Verification (3+ agents)

Fresh-eyes re-test of every Critical + every High finding. The verifier must NOT read the filer's finding body before reading the cited code — they re-construct the reasoning from scratch and come back with CONFIRMED / INVALID / RECLASSIFIED (with new severity).

Verifier groups are batched by theme:

- V01 — Every Critical finding from W1/W2/W3
- V02 — Chained Highs (findings that combine into a higher-severity attack)
- V03 — Per-surface High finding batch
- V04+ — Additional batches if counts demand

Each batch writes a `wave-reports/wave-4-verification-N.md`.

**Wave 4 gate (= audit complete):** every Critical and High has `verified: <CONFIRMED|INVALID|RECLASSIFIED>` stamped in its finding file's front matter AND all W3 pen-test files exist.

## Abort conditions (any wave)

- A wave's subagent returns `status: blocked` with a precondition that can't be met — the cell is marked blocked in plan.yaml and does NOT gate the wave (we proceed without it; blocked cells are listed in the final report as "not audited: <reason>").
- The saturation gate fires and advisor returns SATURATED — the audit ends at whatever wave is in flight; the final report documents the coverage gap.
- `/abadge-security-audit cancel` is invoked — state is preserved, resume later.
