# Decisions log

Date: 2026-05-26. Author: principal eng.

## Disposition of prior audit findings

| Finding | Disposition | Becomes |
|---|---|---|
| W1 profile-grant excludes server_managed (profileId NULL) | CONFIRMED (re-validated, 2 insert sites) | AB-0001 (P0) |
| U1 tenancy = manual org filter, no RLS/scoped client | CONFIRMED | AB-0010 (RLS) + AB-0011 (scoped DAL) — mechanism gated on research |
| U2 audit append-only not DB-enforced | CONFIRMED | AB-0020 (REVOKE+trigger) — gated on PlanetScale role support |
| U3 single global ENCRYPTION_KEY all tenants | CONFIRMED | AB-0030 (per-org HKDF subkey) |
| W2 stale AGENTS.md (onboarding gate, auto-seed) | CONFIRMED | AB-0040 docs |
| W3 content_nonce dead column | CONFIRMED | AB-0041 schema |
| O1 dead audit_log singular table + export | CONFIRMED | AB-0023 schema |
| D5 only audit paginated | CONFIRMED | AB-0050 api |
| W4 agents.createdBy onDelete cascade | CONFIRMED | AB-0043 schema |
| W5 ZK create targets "first" ZK profile | CONFIRMED | AB-0002 (explicit profileId) |
| W6 unauth-bearer audit dedup per-isolate | CONFIRMED (minor) | AB-0021 |
| W7 hand-rolled constant-time compare | REVISED — adequate (hash-of-input); low value to change | DEFER (note §5) |
| D3 AES-GCM random IV ceiling | CONFIRMED | folds into AB-0030 + AB-0031 (rotation ceiling) |
| D6 revoke = hard delete | KEPT (matches model) | no action |
| D1/D2 auth + crypto model divergence | KEPT — code's simpler model is correct; do NOT resurrect plan | docs only |
| M1 hash-chain+anchors+mirror | DE-PRIORITIZED | §5 deferred; cheap subset = AB-0020 |
| M2 type registry, M3 item versions, M4 Shamir | DE-PRIORITIZED | §5 deferred |
| S1-S6 strengths | preserve; add regression tests where thin | AB-0022 (audit invariant tests) |

## Key architectural decisions (seeds for ADRs)
- KEEP single-root-key + daemon-custody ZK model (reject plan ADR-004 ECIES rewrap). Rationale: same ZK guarantee, far less machinery; remote-agent ZK decrypt is explicitly out of scope.
- KEEP Ed25519 challenge/session agent auth (reject plan ADR-002/003 JWT+refresh+attestation). Rationale: private key never leaves device → no refresh-exfil blast radius the plan spends 2 ADRs mitigating.
- ADOPT tenancy defense-in-depth (plan ADR-009 was right; code under-built). Mechanism TBD by research.
- ADOPT cheap audit integrity (REVOKE+trigger), REJECT anchors/mirror for beta.
- server_managed items must carry profileId (fixes W1) — decision: items belong to a profile in BOTH modes; AAD binds real profileId.

## Research-driven decisions (Phase 1)
- D-R1: REJECT HKDF per-org subkeys. HKDF(master, org_id) is deterministic — master disclosure derives every subkey, so it provides NO blast-radius containment, only a per-key nonce budget. ADOPT stored per-profile wrapped DEK (Infisical/Vault shape) instead → AB-0030. The actual env+DB blast-radius fix is KEK->KMS → AB-0033 (deferred, trigger-based).
- D-R2: RLS is P2 defense-in-depth, NOT the primary tenancy control. Hyperdrive transaction-pooling makes `SET LOCAL` a no-op outside an explicit tx → RLS fails OPEN there; and the default PlanetScale role bypasses RLS. Primary control = scoped DAL choke-point (AB-0010), matching Infisical/Vaultwarden. RLS (AB-0011) requires a dedicated NOBYPASSRLS role (AB-0012) + tx-wrapping + a fail-closed guard.
- D-R3: Audit append-only via REVOKE+trigger (AB-0020) is the beta bar; hash-chained/signed/Merkle-anchored audit is DEFERRED (no OSS peer ships it; Vault/OpenBao use field-HMAC + multiple sinks). Optional 2nd sink = AB-0024 (P3).
- D-R4: Pin hono>=4.10.2, @trpc/server>=11.8.0, effect>=3.20.0 (AB-0103). Vulnerable features unused today but semver ranges float into CVE territory. better-auth apiKey CVE not applicable (plugin not registered); still unify version (AB-0100).
- D-R5: A dedicated least-privilege non-owner DB role (AB-0012) is the shared precondition for BOTH audit REVOKE and RLS — it is on the critical path for audit integrity.
