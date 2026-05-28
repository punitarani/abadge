# Wave 2 — Threat-class auditor guidance

Appended to the envelope. You are one of 12 threat-class auditors. Your scope is a single OWASP-style threat class applied **across every surface** that was inventoried in Wave 1.

## Wave 1 inputs

The controller provides paths to all Wave 1 notes files. Read the relevant ones before starting (not all — just the surfaces that naturally touch your threat class). Use Wave 1's inventory to navigate; don't re-inventory.

## Methodology

1. **Read relevant W1 notes** — skim for code references to your threat class.
2. **Construct the question.** "Where in this codebase could <threat class> manifest?" Enumerate candidate code paths across every surface.
3. **Trace each candidate.** Read the code end-to-end. Does the threat actually manifest? Is there a compensating control?
4. **File findings.** For each confirmed or probable manifestation, file a finding with severity from the rubric.
5. **Record negatives.** For candidates that turned out safe, write a negative-result line in your notes: "Tried <threat> at <file:line>, safe because <mechanism>."

## Threat-specific angles

Each threat class has its own hunt pattern. The controller fills `{{scope}}` with one of these:

### T01 Authentication fall-through
- `publicProcedure` vs. `sessionProcedure` vs. `agentProcedure` — any privileged thing on publicProcedure?
- Bearer resolver paths — can any return an identity without checking enabled + !revoked?
- Better Auth catchall routes — method-gating correct?
- OAuth account linking — pre-claim takeover?

### T02 Authorization & capability
- Every reveal/mount checks (orgId, permission, capability expiration)?
- Every `requireOrgRole` call site checks correct role?
- Owner-only endpoints actually owner-only?
- Permission grants on revoked agents blocked?

### T03 Cryptographic correctness
- AAD on every AEAD encrypt/decrypt that should bind context (itemId, orgId, etc.)?
- KDF params have enforced minimums?
- Ed25519 domain separation?
- API-key compare constant-time?
- Nonces truly fresh, not reused?

### T04 Session lifecycle
- Every token hashed before storage?
- Expiry enforced on every use (no bearer fallback that skips it)?
- Revoke propagates to in-flight requests?
- Device-code exchange atomic?

### T05 Input validation
- Every external input validated by Effect Schema?
- Strict vs passthrough consistent?
- MCP zod schemas match server schemas?
- Bounded strings / JSON fields?

### T06 Information disclosure
- Errors scrubbed of SQL, key material, stack traces?
- Enumeration oracles (checkSlug, agent existence)?
- Cache-Control on secret responses?
- Per-agent secret prefix visible to non-owners?

### T07 Races / TOCTOU
- Permission revoke vs. in-flight access (`validatePermissionAccess` race)?
- Agent revoke vs. in-flight?
- `profiles.bootstrap` atomic?
- Daemon `chmod` after `bind` window?
- Mount file: perm check → open race?

### T08 Secret leakage
- MCP `run_with_secret` redaction — long-secret bypass, encoding bypass?
- Audit log `meta` field echoing input?
- tRPC validation errors echoing values?
- CLI `run` process.env passthrough?

### T09 Rate limiting & DoS
- Per-IP vs per-isolate?
- Unauth endpoints (createChallenge) → table growth?
- Argon2id memory pin appropriate?
- Payload size cap?
- Daemon connection cap, buffer cap?

### T10 Supply chain
- Lockfile/package.json mismatch?
- `"latest"` pins anywhere?
- GitHub Actions pinned to tag not SHA?
- Better Auth CLI version split from runtime?

### T11 Headers / cookies / CORS / CSP
- HSTS, X-Content-Type-Options, COOP/CORP, Referrer-Policy on every public origin?
- Cookie flags (`Secure`, `SameSite`, `__Host-`)?
- CORS trusted origins correct and minimal?
- CORS `allowMethods` doesn't include unused verbs?

### T12 Audit log integrity
- Every allowed AND denied attempt logged?
- `safeAuditInsert` silent failure → accesses slip through unaudited?
- Unrecognized bearer — audited?
- IP spoofability outside Cloudflare?
- `audit throw` inverts caller safety?

## Notes file structure

Same as W1 notes file, but with "Threat class" header instead of "Surface":

```markdown
# Threat audit notes: <threat class>

**Auditor:** {{agent_id}}
**Threat class:** {{scope}}
**Wave 1 notes consulted:** notes/api.md, notes/daemon.md, ...

## Question
Where in the codebase could <threat class> manifest?

## Candidates traced
| Candidate | File:line | Verdict | Note |
|---|---|---|---|
| ... | ... | safe / finding {{agent_id}}-001 / ... | ... |

## Findings filed
...

## Negative results
...

## Cross-surface patterns observed
If you notice the same class of flaw in multiple surfaces, note that — it may warrant a composite finding in W4.
```
