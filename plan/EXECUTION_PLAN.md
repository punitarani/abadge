# abadge — Execution Plan

Principal engineer, 2026-05-26. Branch `claude/trusting-darwin-EkBw9`.
Source of truth for tasks: `plan/action_items.json` (29 items); full schema render in `plan/action_items.md`.
This document is the narrative: direction, architecture, sequencing, deferrals, open questions, self-critique.

---

## 1. Executive direction

abadge is closer to shippable than the original draft plan implies, because the team built a smaller, more defensible system than the plan specified — and that instinct was right. The shipped crypto envelope (domain-separated AAD binding, per-profile root key, daemon custody), the audit-before-decrypt access pipeline, atomic permission batches, and the Ed25519 challenge/session agent auth are all sound and worth protecting. The plan's heavier machinery — per-recipient ECIES rewrap, refresh-token+JWT+platform-attestation, hash-chained Merkle-anchored audit, external KMS, a type registry — is mostly over-built for a beta, and external benchmarking confirms that mature peers (Infisical, Vault, OpenBao, Vaultwarden) do not ship most of it either. So this plan deliberately does not resurrect the draft; it fixes the few places the code is genuinely wrong or under-built, and defers the rest with explicit triggers.

There are three architectural moves for this round. First, close the one real correctness defect: server-managed items are created profile-less (`items.ts:229-238`), so profile-level grants silently never cover them even though server-managed is the default storage mode — this is AB-0001 and it is the only P0. Second, make tenancy and audit isolation enforceable rather than conventional: a single org-scoped data-access choke-point (AB-0010) as the primary control, a least-privilege non-owner DB role (AB-0012) that unlocks DB-level append-only audit via REVOKE+trigger (AB-0020), and RLS as a gated defense-in-depth backstop (AB-0011) — not the primary control, because Hyperdrive's transaction pooling makes RLS fail *open* outside an explicit transaction. Third, bring server-managed key handling up to the industry norm with per-profile envelope encryption (AB-0030), which contains the GCM nonce budget and enables cheap key rotation, while honestly deferring the true env+DB blast-radius fix (KEK to KMS, AB-0033) behind a customer-driven trigger.

The trade-off I am making explicit: I am choosing operability and proportionality over the draft's maximalism. RLS is demoted to a backstop because, under Cloudflare Hyperdrive, a misapplied `SET LOCAL` silently disables the filter — a fail-open control is worse than an honest app-layer choke-point, so the choke-point leads and RLS follows only with a fail-closed guard. I am rejecting HKDF-per-org subkeys (the draft's instinct) because keys derived from the same master give zero blast-radius containment against master disclosure; the stored-wrapped-DEK envelope every peer uses is both more honest and operationally superior for rotation. The critical path to a shippable beta runs through AB-0001 (correctness), AB-0010 (tenancy choke-point, the single largest beta item at ~1 week), and the AB-0012→AB-0020 audit-integrity chain; everything else parallelizes around those. Hash-chained audit, attestation, KMS, and a type registry are all post-beta with named triggers in §5.

---

## 2. Updated architectural posture

### Crypto envelope
Target state: ZK stays exactly as built — per-item DEK under a per-profile root key, XChaCha20-Poly1305, the excellent domain-separated AAD scheme in `crypto/shared/aad.ts` — this is not touched except to keep its round-trip tests. Server-managed encryption moves from "one global AES key, direct encrypt" to a per-profile envelope: a random 256-bit DEK per profile, stored wrapped under the env KEK, with item content encrypted under the DEK (AB-0030). This is the shape Infisical/Vault/OpenBao all use and it is the prerequisite for cheap KEK rotation and a future KMS migration. The change is additive: a scheme marker lets existing direct-KEK rows (`serverKeyVersion>=2`) keep decrypting while new rows use the DEK envelope. Per-profile keys also make the AES-GCM random-IV nonce budget per-profile rather than global, which all but removes the NIST 2^32 ceiling concern (AB-0031). Key commitment (AB-0032) is cheap insurance once we are multi-key, but it is P3. The honest limitation — env-key plus DB dump still decrypts everything — is documented and its fix (KEK to a separate trust domain) is AB-0033, deferred.

> **ADR-R3 (revises plan ADR-005) — Server-managed key management: per-profile wrapped DEK, env KEK now, KMS later**
> **Context.** Server-managed items are encrypted directly under one global `ENCRYPTION_KEY` (`items.ts:225`). Every peer secret manager uses envelope encryption with per-tenant DEKs; abadge does not. The draft (ADR-005) proposed an external KMS-wrapped DEK per item from day one.
> **Decision.** Introduce a per-profile random DEK stored wrapped under the existing env KEK (AES-256-GCM key wrap, AAD-bound to org+profile); encrypt item content under the DEK. Keep the KEK in Worker env for beta. Reject HKDF-derived-from-master subkeys (deterministic ⇒ no containment). Defer moving the KEK to KMS (ADR-R3b / AB-0033).
> **Alternatives.** (a) HKDF per-org subkey — rejected: master disclosure derives all subkeys, no blast-radius benefit, and master rotation forces full re-encryption. (b) Per-item KMS DEK now (draft ADR-005) — rejected for beta: cross-cloud IAM + a KMS round-trip per decrypt is ops cost beta does not need. (c) Status quo single key — rejected: weaker than every peer, global GCM nonce budget, no per-tenant rotation.
> **Consequences.** Per-tenant rotation and a future KMS migration become rewrap-only (no content re-encryption). Per-profile nonce budgets. New `profiles.serverWrappedDek` column + a scheme marker on items. Does not, alone, contain an env-key disclosure — that is explicitly deferred to AB-0033 and documented in SECURITY.md.

### Tenancy isolation
Target state: a single org-scoped data-access layer is the only way application code touches the five tenant tables (items, profiles, agents, permissions, audit_logs), always injecting `organizationId` from request identity (AB-0010), enforced by a lint/CI rule that bans direct table imports outside that layer. This matches how Infisical and Vaultwarden actually enforce isolation, and removes the "single forgotten WHERE clause" failure mode that exists today across ~20 hand-written filter sites. RLS is added as a database backstop (AB-0011) but only behind a dedicated NOBYPASSRLS, non-owner role (AB-0012) and only with every scoped query wrapped in a transaction whose first statement is `SET LOCAL app.current_org` — because under Hyperdrive transaction pooling a `SET LOCAL` outside a transaction is a no-op and the query runs unfiltered (fail-open). For that reason RLS is P2 and gated on a fail-closed guard test; the choke-point, not RLS, is the control we rely on for beta.

> **ADR-R4 (revises plan ADR-009) — Tenancy: app-layer scoped DAL primary, RLS as gated backstop**
> **Context.** Tenancy is enforced by manually repeated `eq(organizationId, …)` clauses with no choke-point, no RLS, no lint guard. The draft (ADR-009) wanted RLS + scoped client + lint rule together.
> **Decision.** Build the scoped DAL as the primary, reliable control. Add RLS only as defense-in-depth, behind a dedicated NOBYPASSRLS role, with mandatory transaction-wrapped `SET LOCAL` and a test proving non-tx scoped queries fail closed.
> **Alternatives.** (a) RLS-primary (draft) — rejected: Hyperdrive `SET LOCAL` fails open outside a tx, and the default PlanetScale role bypasses RLS; an unreliable primary control is dangerous. (b) Status quo app filters — rejected: no structural guardrail. (c) Storage-barrier choke-point like Vault — rejected: abadge is relational, not a KV barrier; the scoped DAL is the relational equivalent.
> **Consequences.** New `scoped-db` module + import-ban CI rule. RLS requires the AB-0012 role and tx discipline. Hyperdrive query caching must be handled for authz reads (AB-0052).

### Audit integrity
Target state: append-only stops being a convention and becomes a database guarantee — `REVOKE UPDATE, DELETE, TRUNCATE` on `audit_logs` from the app role plus a `BEFORE UPDATE/DELETE` trigger that raises (AB-0020), both verified feasible on PlanetScale Postgres. The dead duplicate `audit_log` (singular) table and export are retired (AB-0023) so nothing can write audit rows to a table nothing reads. The pipeline's audit-before-decrypt and atomic mount+audit invariants get explicit regression tests (AB-0022) so a refactor cannot silently void them. Hash-chaining and signed Merkle anchors are deferred: no OSS peer ships them, and Vault/OpenBao's documented tamper-detection is field-HMAC plus multiple sinks, so an optional second append-only sink (AB-0024) is the proportional insider-threat control, kept P3.

> **ADR-R5 (revises plan ADR-007) — Audit: DB-enforced append-only now; chaining/anchors deferred**
> **Context.** `audit_logs` is append-only only because the app never issues UPDATE/DELETE; the draft (ADR-007) specified a hash chain + signed Merkle anchors + R2 mirror.
> **Decision.** Enforce append-only at the DB (REVOKE + trigger). Defer hash-chaining and anchoring. Offer an optional second sink for divergence-based tamper detection.
> **Alternatives.** (a) Hash chain + anchors now (draft) — rejected: high build cost, no OSS peer ships it, over-scoped for beta. (b) Keep convention-only — rejected: a single UPDATE can erase evidence with no detection.
> **Consequences.** Requires the AB-0012 role. Tamper-evidence is "DB cannot mutate via the app role" + optional sink divergence, not cryptographic chaining; documented as such.

### Auth boundary
Holds as built; the draft's ADR-002/003 are rejected for beta. The Ed25519 challenge→exchange→`abs_` session flow with SDK background re-exchange is coherent and avoids the refresh-token-exfiltration problem the draft spent two ADRs mitigating, because the private key never leaves the device. Single-use enrollment with conditional-update race guards (`auth.ts:416-491`) is genuinely good. The only auth-adjacent work is hygiene: unify Better Auth versions across the workspace (AB-0100), since the `apiKey`-plugin CVE does not apply (plugin not registered) but version skew between the API and `packages/auth` is its own risk. Platform attestation stays out of scope.

> **ADR-R2 (supersedes plan ADR-002/003) — Agent auth stays Ed25519 challenge/session.** Keep opaque `abs_` session tokens via signed-challenge exchange; no JWT, JWKS, refresh-token endpoint, or platform attestation. Preserved by leaving `routers/auth.ts` and `server/auth.ts` as-is and by AB-0100 (version hygiene only). Rationale: private key never leaves device ⇒ no "minted-from-anywhere" blast radius; attestation's 4-provider plugin surface is unjustified for beta.

### Permissions
Target state: the explicit `(agent, item|profile, capability)` model holds (it is a sound simplification of the draft's selector+actions scheme and matches the "no wildcards for v1" invariant), with one fix — profile-target grants must actually cover server-managed items, which today they silently do not because those items have no profileId (AB-0001). Set-style/path-glob cascades (how Vault and Infisical auto-cover new matching secrets) are a deliberate defer; profile-level grant is abadge's coarse analog and is enough for beta. The atomic batch insert with full matrix/duplicate violation reporting is preserved and is a strength.

> **ADR-006 (plan) HOLDS — capabilities over RBAC/ABAC.** The shipped explicit-grant model is the right call; preserved by AB-0001/AB-0002, no redesign. Path-glob set-grants deferred (§5).

### Schema
Target state: `items.profileId` is set for both storage modes (AB-0001/AB-0002); the dead `content_nonce` column is dropped (AB-0041); `agents.createdBy` FK becomes `ON DELETE SET NULL` so org-scoped agents don't die with their creating user (AB-0043); the legacy `audit_log` table is dropped (AB-0023). All are small, additive-or-cleanup migrations. The exactly-one-target CHECK on permissions and the advisory-lock ZK create path are preserved as-is.

### API
Target state: cursor pagination extends to items/permissions/agents (AB-0050), reusing the audit cursor pattern, so large orgs don't get unbounded payloads. Every secret-bearing response carries `Cache-Control: no-store` (AB-0051). The error envelope stays `{code,message,hint,meta}` (richer than the draft's shape) and the API docs are corrected to match (AB-0044). REST-over-tRPC reflection stays as built.

### Infra
Target state: the app connects as a least-privilege non-owner role (AB-0012) — the precondition for both audit REVOKE and RLS — with migrations run under a separate owner role. Hyperdrive query caching is disabled (or made uncacheable) for authorization-sensitive reads (AB-0052) so a revoked permission or disabled agent cannot keep authorizing for the cache TTL. These are the two infra items on the security-correctness path.

### sdk-cli-mcp
Holds; in good shape (verified: MCP never returns secret bytes/paths, daemon socket and mounts are hard-asserted 0600, SDK auto-refresh works). Only housekeeping: remove the `@deprecated` SDK access methods at the v0.6 cut (AB-0080).

### web
Holds; client-side ZK encryption, 30-minute inactivity key auto-lock, and grant-as-permission-row are all correct. No dedicated web items beyond inheriting AB-0050 (pagination) and AB-0051 (no-store on operator reveal). WebAuthn-bound unlock is a post-beta enhancement (§5), not a gap.

### Supply-chain
Target state: pin `hono>=4.10.2`, `@trpc/server>=11.8.0`, `effect>=3.20.0` above known-CVE lines (AB-0103) even though the vulnerable features are unused; unify Better Auth (AB-0100); add a CI vulnerability scan gated on high/critical (AB-0101). SBOM + signed CLI releases (AB-0102) is P3. Lockfile + `--frozen-lockfile` in CI already exist and are kept.

### Ops
Target state: a tested key-rotation runbook for the env KEK and per-profile DEKs (AB-0090), and a lightweight logging redaction guard so a future code path can't print plaintext (AB-0091, P3). Recovery-key UX already exists in code; the runbook documents it.

---

## 3. Workstreams and sequencing

### Per-workstream item sets and exit criteria

- **permissions** — AB-0001 (P0), AB-0002 (P1), AB-0003 (P2). Order: AB-0001 first (defaults to seeded profile), AB-0002 parallel (explicit selection), AB-0003 after AB-0001. *Exit for beta:* profile-level grants cover server-managed items; create can target an explicit profile; existing rows still decrypt.
- **crypto** — AB-0030 (P2), AB-0031 (P2), AB-0032 (P3), AB-0033 (P3). Order: AB-0030 (needs AB-0001) → AB-0031, then AB-0032/AB-0033 post-beta. *Exit for beta:* per-profile envelope live for new rows; nonce ceiling documented. (AB-0030 itself is beta-optional; see critical path.)
- **tenancy** — AB-0010 (P1), AB-0011 (P2, needs AB-0010+AB-0012). Order: AB-0010 first. *Exit for beta:* all tenant-table access via the scoped DAL + import-ban CI rule green; cross-org tests pass. RLS may land post-beta.
- **audit** — AB-0020 (P1, needs AB-0012), AB-0022 (P1), AB-0023 (P2), AB-0021 (P3), AB-0024 (P3). Order: AB-0022 immediately (no deps); AB-0020 after AB-0012; AB-0023 anytime. *Exit for beta:* DB rejects UPDATE/DELETE on audit_logs as the app role; invariant regression tests pass; dead table dropped.
- **infra** — AB-0012 (P1), AB-0052 (P1). Order: AB-0012 early (it blocks audit+RLS); AB-0052 parallel. *Exit for beta:* runtime connects as NOBYPASSRLS non-owner role; authz reads not stale-served by Hyperdrive cache.
- **api** — AB-0051 (P1), AB-0050 (P2), AB-0044 (P2, needs AB-0050). *Exit for beta:* no-store on secret responses; pagination on items/permissions/agents.
- **schema** — AB-0041 (P2), AB-0043 (P2), (AB-0023 lives in audit). *Exit for beta:* clean migrations applied; dead column gone; agent FK fixed.
- **supply-chain** — AB-0100 (P1), AB-0103 (P1), AB-0101 (P2), AB-0102 (P3). *Exit for beta:* deps pinned above CVE lines; Better Auth unified; CI vuln scan gating high/critical.
- **docs** — AB-0040 (P1), AB-0044 (P2). *Exit for beta:* AGENTS.md no longer asserts the removed onboarding gate; API docs match the real envelope.
- **ops** — AB-0090 (P2), AB-0091 (P3). *Exit for beta:* rotation runbook rehearsed in staging.
- **sdk-cli-mcp** — AB-0080 (P3). Post-beta.

### Critical path (longest dependency chain to beta)
`AB-0012 (provision DB role, M) → AB-0020 (audit REVOKE+trigger, S)` is the audit-integrity chain, and `AB-0010 (scoped DAL, L)` is the single largest standalone beta item (~1 week). These two run in parallel; beta wall-clock is gated by **AB-0010 (≈1 week)**. The crypto chain `AB-0001 (M) → AB-0030 (L) → AB-0033` is longer but AB-0030 onward is beta-optional, so it is off the beta critical path. Net: beta critical path ≈ max(AB-0010, AB-0012→AB-0020) ≈ AB-0010.

### Parallelizable now (no cross-deps)
AB-0001, AB-0002, AB-0010, AB-0012, AB-0022, AB-0023, AB-0040, AB-0041, AB-0043, AB-0050, AB-0051, AB-0052, AB-0100, AB-0103 can all start immediately on separate tracks. AB-0020 waits only on AB-0012; AB-0011 on AB-0010+AB-0012; AB-0030 on AB-0001; AB-0044 on AB-0050.

### Beta gate (must-ship)
P0 + the security/correctness P1s: AB-0001, AB-0010, AB-0012, AB-0020, AB-0022, AB-0051, AB-0052, AB-0100, AB-0103, AB-0040. Everything P2/P3 is post-gate unless it falls out of a P1 cheaply (e.g. AB-0041/AB-0043 ride along with other migrations).

### Deferred past beta (with revisit trigger)
- AB-0030/AB-0031 (per-profile envelope): trigger = before onboarding a customer with compliance requirements, or when any single key approaches ~2^30 server-managed encryptions.
- AB-0033 (KEK→KMS): trigger = first regulated/enterprise customer, or when the env+DB double-compromise enters the threat model.
- AB-0011 (RLS): trigger = after AB-0010 lands and tenant queries are uniformly tx-wrapped; ship as defense-in-depth then.
- AB-0024 (second audit sink), AB-0032 (key commitment), AB-0102 (SBOM/signing), AB-0091 (log redaction), AB-0080 (SDK cleanup): opportunistic / next minor.

---

## 4. Action items

The full schema-rendered list (all 29 items, every field) is in **`plan/action_items.md`**, generated from the source-of-truth **`plan/action_items.json`**. Compact priority-ordered index below; see those files for problem/rationale/approach/acceptance/validation/risk per item.

### P0
| ID | Title | WS | Eff | Deps |
|----|-------|----|-----|------|
| AB-0001 | Bind server-managed items to a profile (fix profile-grant coverage + AAD) | permissions | M | — |

### P1
| ID | Title | WS | Eff | Deps |
|----|-------|----|-----|------|
| AB-0002 | Accept explicit profileId on item.create (both modes) | api | M | — |
| AB-0010 | Org-scoped data-access layer as primary tenancy control | tenancy | L | — |
| AB-0012 | Provision least-privilege non-owner DB role | infra | M | — |
| AB-0052 | Disable Hyperdrive query caching for authz reads | infra | S | — |
| AB-0020 | DB-enforced append-only audit (REVOKE + trigger) | audit | S | AB-0012 |
| AB-0022 | Regression tests for audit-before-decrypt + atomic mount+audit | audit | M | — |
| AB-0051 | Cache-Control: no-store on secret-bearing responses | api | S | — |
| AB-0040 | Fix AGENTS.md (removed onboarding gate, profile auto-seed) | docs | S | — |
| AB-0100 | Align Better Auth versions across workspace | supply-chain | S | — |
| AB-0103 | Pin runtime deps above CVE thresholds (hono/trpc/effect) | supply-chain | S | — |

### P2
| ID | Title | WS | Eff | Deps |
|----|-------|----|-----|------|
| AB-0003 | Backfill existing server-managed items into default profile | permissions | M | AB-0001 |
| AB-0011 | Postgres RLS backstop (NOBYPASSRLS role + tx SET LOCAL) | tenancy | L | AB-0010, AB-0012 |
| AB-0030 | Per-profile envelope encryption (wrapped DEK) | crypto | L | AB-0001 |
| AB-0031 | Bound/monitor AES-GCM nonce usage + rotation ceiling | crypto | M | AB-0030 |
| AB-0023 | Retire dead singular audit_log table + export | schema | S | — |
| AB-0041 | Drop dead content_nonce column | schema | S | — |
| AB-0043 | agents.createdBy → ON DELETE SET NULL | schema | M | — |
| AB-0050 | Cursor pagination for items/permissions/agents | api | M | — |
| AB-0044 | Correct API docs (error envelope + pagination) | docs | S | AB-0050 |
| AB-0090 | ENCRYPTION_KEY / server-key rotation runbook | ops | M | AB-0030 |
| AB-0101 | CI dependency vulnerability scan | supply-chain | S | — |

### P3
| ID | Title | WS | Eff | Deps |
|----|-------|----|-----|------|
| AB-0021 | Correct per-isolate unauth-bearer audit dedup | audit | S | — |
| AB-0024 | Stream audit_logs to a second append-only sink | audit | M | AB-0020 |
| AB-0032 | Key commitment for server-managed AEAD | crypto | M | AB-0030 |
| AB-0033 | Move root KEK to KMS (blast-radius, deferred) | crypto | L | AB-0030 |
| AB-0091 | Structured-logging redaction guard | ops | S | — |
| AB-0102 | SBOM + signed CLI release artifacts | supply-chain | M | — |
| AB-0080 | Remove deprecated SDK access methods at v0.6 | sdk-cli-mcp | S | — |

---

## 5. Deferred and rejected

- **Per-recipient ECIES DEK rewrap (plan ADR-004)** — rejected for the product as built. The root-key + daemon-custody model delivers the same ZK guarantee with far less machinery; remote-agent ZK decrypt is out of scope by design. Revisit only if remote agents must decrypt ZK items without a co-located daemon.
- **Refresh-token + JWT + JWKS + platform attestation (plan ADR-002/003)** — rejected. The Ed25519 session model is better for the threat (no key leaves the device). Attestation's multi-provider plugin surface is unjustified for beta.
- **Hash-chained + signed-anchor + R2-mirror audit (plan ADR-007)** — deferred. No OSS peer ships it; AB-0020 (DB append-only) + AB-0024 (optional second sink) is the proportional bar. Trigger: a contractual tamper-evidence requirement.
- **Per-item KMS DEK from day one (plan ADR-005)** — deferred to AB-0033 (KEK→KMS), reshaped as rewrap-only on top of AB-0030. Trigger: regulated/enterprise customer.
- **Item type registry + per-type JSON schema + `/types` (plan ADR-008)** — deferred. The `kind` enum + STANDARD_FIELDS_BY_KIND is sufficient; a registry is a code change vs a registry deploy, acceptable for beta.
- **Item version history / 7-day rollback** — deferred; optimistic concurrency without history is fine for beta.
- **Shamir-split recovery escrow** — deferred; the single recovery key already exists and is enough.
- **Path-glob / set-style auto-cascading grants (Vault/Infisical pattern)** — deferred; profile-level grant is the coarse analog and honors "no wildcards for v1." Trigger: agents needing a growing secret set without re-granting.
- **WebAuthn-bound key unlock in the web app** — deferred; password-derived KEK + 30-min auto-lock is acceptable for beta. Trigger: high-value-tenant hardening.
- **W7 hand-rolled constant-time compare** — not actioned. Re-examined: it compares SHA-256 hashes of the input in a constant-time loop over fixed-length strings, so it leaks nothing useful even if imperfect; replacing it is low value. Left as-is.
- **Rejected per scope/authority:** nothing proposed weakens the ZK guarantee or tenancy isolation; no item was dropped for violating authority.

---

## 6. Open questions

From `plan/hypotheses.md`, the ones still open and what resolves each:

1. **RLS through Hyperdrive in practice (H1).** Research confirms `SET LOCAL`-in-transaction is safe and fails open outside a tx; what is unverified is whether *every* current tenant query can be cheaply tx-wrapped without a latency regression. Resolves: a spike wrapping the hottest read path (item list) in a tx with `SET LOCAL` and benchmarking p95. Hinges: AB-0011 scope and whether it stays P2 or slips post-beta.
2. **AB-0030 key granularity: per-profile vs per-org (H5).** I chose per-profile because items belong to profiles after AB-0001, but per-org is simpler if most orgs have one profile. Resolves: check production/seed data for profiles-per-org distribution. Hinges: AB-0030 schema (column on profiles vs organization).
3. **Existing server-managed row backfill cost (H3/H4).** The W1 fix is additive for new rows; whether AB-0003's re-encryption backfill is worth running depends on how many legacy NULL-profile server-managed rows exist. Resolves: a `COUNT(*) WHERE storage_mode='server_managed' AND profile_id IS NULL` per env. Hinges: AB-0003 priority.
4. **effect 3.13→3.20 bump safety (AB-0103).** The CVE path (RpcServer.toWebHandler) appears unused, but the minor jump may carry behavior changes. Resolves: bump in a branch, run full suite, read the changelog. Hinges: AB-0103 effort/risk.
5. **Daemon TOFU pinning robustness (H6).** Not verified this pass. Resolves: read `packages/cli/src/daemon.ts` pinning + `daemon-client.ts` and threat-model a local socket MITM. Hinges: whether a new ops/sdk-cli-mcp item is needed (none created yet).

---

## 7. Self-critique

The decision I am least sure of is demoting RLS (AB-0011) to a P2 backstop rather than making it a beta blocker. My reasoning is sound on the mechanics — Hyperdrive's transaction pooling genuinely makes `SET LOCAL` fail open outside a transaction, and a fail-open control is a liability — but I am leaning hard on the scoped DAL (AB-0010) being implemented well enough that the database backstop is not load-bearing for beta, and that is a bet on execution quality in a credential vault where a single cross-tenant leak is catastrophic. If the team cannot land AB-0010 as a clean choke-point with a CI import-ban that actually holds, I would be wrong to ship beta without RLS, and I would promote AB-0011 to P1 and pay the tx-wrapping cost. The second-lowest-confidence call is treating AB-0030 (per-profile envelope) as beta-optional; the benchmark is unambiguous that one global key is where abadge is weakest versus peers, and a reviewer could reasonably argue it belongs in the beta gate — I kept it P2 because it does not fix a live exploit (env disclosure alone yields no ciphertext; DB disclosure alone yields no key) and the AAD already prevents relocation, but I hold that loosely. What would change my mind on both: evidence that the team's query-layer discipline is shaky (push RLS into beta) or that a near-term customer has a compliance posture requiring documented per-tenant key isolation (push AB-0030/AB-0033 into beta). Everything else in this plan I am confident is correctly prioritized; the P0 (AB-0001) is unambiguous, and the audit/infra chain is cheap, high-value, and well-understood.
