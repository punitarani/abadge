# abadge execution plan — progress

Role: principal engineer turning the prior audit into an execution plan.
Branch: claude/trusting-darwin-EkBw9

## Phase log

### Phase 0 — reread audit + close self-check gaps  [DONE]
- Reread all prior findings (D1-6, O1-2, U1-3, M1-4, S1-6, W1-7). Disposition table in decisions.md.
- Closed self-check gaps:
  - Mount redemption (`access.ts:942-1024`): atomic CAS consume, fail-closed NOT_FOUND, denied-audit, org-scoped item reload. VERIFIED OK.
  - KDF params (`crypto/shared/types.ts:48-55`): Argon2id m=64MiB t=3 p=1 len=32 = RFC 9106 2nd profile. VERIFIED OK.
  - All `insert(items)` sites (only 2): ZK sets profileId (items.ts:159), server_managed does NOT (items.ts:229, AAD sentinel at :220). W1 CONFIRMED high-confidence.
  - CORS (`apps/api/src/index.ts:46-50` + `auth/server.ts:88-98`): origin allowlist + credentials:true, not wildcard. VERIFIED OK.

### Phase 1 — external research (parallel subagents)  [DONE]
- A (PlanetScale+Hyperdrive): RLS SUPPORTED-WITH-CAVEATS (fails OPEN outside a tx under Hyperdrive pooling; default role bypasses RLS). REVOKE+triggers SUPPORTED via custom roles. NEW: Hyperdrive caches reads ~60s, no write-invalidation → stale-authz risk.
- B (benchmark): Infisical/Vaultwarden = app-layer scoping (no RLS); Vault/OpenBao = storage-barrier choke-point. ALL peers use per-tenant wrapped-DEK envelope (none uses one global key). NO peer ships hash-chained audit in OSS → defer confirmed.
- C (crypto/CVE): NIST 2^32 random-IV GCM ceiling confirmed (catastrophic on collision). HKDF-from-master gives NO blast-radius containment (deterministic) → use stored wrapped DEK instead. CVEs: hono>=4.10.2, @trpc/server>=11.8.0, effect>=3.20.0 (features unused but ranges float); better-auth apiKey CVE not applicable.

### Phase 2 — workstream design notes + ADR deltas  [DONE — in EXECUTION_PLAN.md]
### Phase 3 — action item generation (JSON + MD)  [DONE — 29 items, validated]
### Phase 4 — sequencing, critical path, deferred/open/self-critique  [DONE — in EXECUTION_PLAN.md]
### Phase 5 — final assembly + checkpoint commit  [DONE]
- Deliverable: plan/EXECUTION_PLAN.md (7 sections + revised ADRs R2/R3/R4/R5).
- plan/action_items.json (29 items, validated) + plan/action_items.md (full render).
- Committed + pushed to claude/trusting-darwin-EkBw9; draft PR opened.

## Key research-driven design changes vs initial draft
- AB-0030 reframed: HKDF per-org REJECTED (no containment vs master disclosure) → stored per-profile wrapped DEK (Infisical shape). True blast-radius fix = KEK->KMS, split to AB-0033 (deferred).
- RLS demoted to P2 backstop (fails open outside tx); scoped DAL (AB-0010) is the P1 primary control (matches Infisical/Vaultwarden).
- NEW: AB-0052 (Hyperdrive cache vs authz reads), AB-0103 (dep CVE pinning), AB-0032 (key commitment), AB-0024 (2nd audit sink).

## Workstreams
crypto · tenancy · audit · auth · permissions · schema · api · sdk-cli-mcp · web · ops · supply-chain · infra

## Critical-path hypothesis
W1 (profile-grant/server-managed) is the only correctness P0. Tenancy RLS + audit append-only are the
defense-in-depth P1s but their *mechanism* depends on Phase-1A research (Hyperdrive pooling vs SET LOCAL).
If RLS is unworkable through Hyperdrive, fall back to a scoped data-access layer (app-level) as U1.
