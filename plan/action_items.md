# abadge execution plan — action items

Generated from action_items.json. 29 items.

## P0

### AB-0001 — Bind server-managed items to a profile so profile-level grants and AAD both cover them
- **Workstream/Category:** permissions / bug-fix
- **Severity/Confidence/Effort:** high / high / M
- **Source:** audit-finding:W1
- **Blocks:** AB-0003
- **Problem:** Server-managed items are inserted with profileId=NULL (items.ts:229-238) and their AAD uses the null sentinel (items.ts:220). The access pipeline only matches profile-target grants when item.profileId is non-null (access/pipeline.ts:150-156), so profile-level permission grants silently never cover server-managed items — which is the DEFAULT storage mode.
- **Rationale:** An operator who grants an agent 'use' on a profile gets zero coverage of the server-managed secrets they created there; the grant fails closed and silently, breaking the primary grant workflow for the default item type.
- **Scope:** In: resolve and persist a real profileId on server-managed item create; use that profileId in the create AAD. Out: backfilling existing NULL-profile rows (separate item AB-0003).
- **Approach:** At create, resolve the org's target server_managed profile (default seeded profile, or explicit profileId from AB-0002), set items.profileId, and pass profileIdForServerAad(profile.id) into the create AAD at items.ts:218-223. Update/decrypt paths already key AAD off the stored item.profileId (items.ts:360,449), so the change is additive: existing NULL rows keep decrypting under the sentinel, new rows bind the real profile.
- **Acceptance:**
  - A server_managed item created via items.create has a non-null profileId equal to the resolved profile
  - An agent with a profile-target 'use' grant can access a newly created server_managed item in that profile (integration test)
  - An existing server_managed row created before this change (profileId NULL) still decrypts successfully (regression test on sentinel AAD)
  - Round-trip encrypt/decrypt of a new server_managed item succeeds with profile bound in AAD
- **Validation:** Integration test: seed server_managed profile, create item, grant profile-level use to an agent, assert access.use succeeds; plus a regression test decrypting a pre-existing sentinel-AAD row.
- **Risk:** Changing create AAD could strand new rows if the decrypt branch is missed — mitigated because decrypt/update already read stored profileId; covered by round-trip test.
- **Files:** packages/trpc/src/server/routers/items.ts, packages/trpc/src/server/routers/access/pipeline.ts

## P1

### AB-0002 — Accept an explicit profileId on item.create for both storage modes
- **Workstream/Category:** api / new-impl
- **Severity/Confidence/Effort:** medium / high / M
- **Source:** audit-finding:W5
- **Problem:** ZK item creation always targets the arbitrary 'first' ZK profile in the org (items.ts:102-111) and server-managed creation targets no profile at all. An org with more than one profile cannot control where an item lands.
- **Rationale:** Multi-profile orgs get non-deterministic, uncontrollable item placement; an operator cannot put a secret in the profile they intend, which corrupts the profile-as-encryption-boundary model.
- **Scope:** In: add optional profileId to CreateItemSchema; validate it belongs to the org and matches the storage mode; default to the org's default profile of that mode when omitted. Out: cross-profile moves of existing items.
- **Approach:** Extend CreateItemSchema in @abadge/core with optional profileId; in createItem resolve target profile = input.profileId ?? defaultProfileForMode(org, mode), validating org ownership + storageMode match; feed it into both the ZK insert (already sets profileId) and the server-managed insert (AB-0001).
- **Acceptance:**
  - items.create with an explicit valid profileId stores the item under that profile
  - items.create with a profileId from another org returns PROFILE_NOT_FOUND
  - items.create with a profileId whose storageMode mismatches the item mode returns a validation error
  - items.create with no profileId uses the org default profile for that mode
- **Validation:** Unit tests on schema validation + integration tests for the four cases above.
- **Risk:** Schema change ripples to SDK/CLI/web create paths — mitigated by keeping profileId optional (backward compatible).
- **Files:** packages/core/src/schemas.ts, packages/trpc/src/server/routers/items.ts, packages/sdk/src/client.ts, apps/web/src/components/dashboard/create-item-panel.tsx

### AB-0051 — Set Cache-Control: no-store on all secret-bearing API responses
- **Workstream/Category:** api / security-fix
- **Severity/Confidence/Effort:** medium / medium / S
- **Source:** new-from-first-principles
- **Problem:** No Cache-Control: no-store header is set on responses that carry plaintext or ciphertext (access reveal/redeem, items.ownerReveal); grep of apps/api/src shows no no-store middleware.
- **Rationale:** A secret-bearing response without no-store can be cached by a browser, intermediary proxy, or service worker, leaking the secret to disk/shared cache — a concrete exfiltration vector for the operator-reveal and agent-redeem paths.
- **Scope:** In: middleware that sets Cache-Control: no-store, no-cache, must-revalidate + Pragma: no-cache on secret-bearing routes (access/*, items reveal). Out: caching policy for static metadata lists.
- **Approach:** Add Hono middleware keyed on the secret-bearing route prefixes (or set unconditionally for /v1 and tRPC mutation responses) that injects no-store headers; assert in tests.
- **Acceptance:**
  - Responses from access reveal/use/redeem and items.ownerReveal carry Cache-Control: no-store
  - A test asserts the header on at least the reveal and redeem responses
  - Non-secret metadata endpoints are unaffected (or also no-store if chosen)
- **Validation:** Integration test inspecting response headers on secret-bearing endpoints.
- **Risk:** Over-broad no-store reduces caching benefit — negligible for an operator/agent API.
- **Files:** apps/api/src/index.ts, apps/api/src/middleware/

### AB-0020 — Enforce audit_logs append-only at the database via REVOKE + immutability trigger
- **Workstream/Category:** audit / security-fix
- **Severity/Confidence/Effort:** high / high / S
- **Source:** audit-finding:U2
- **Depends on:** AB-0012
- **Problem:** audit_logs is append-only only by convention; no migration revokes UPDATE/DELETE and no trigger blocks mutation (grep of packages/db/migrations confirms absence). A bug, compromised Worker, or insider can silently rewrite or delete audit rows.
- **Rationale:** The product's 'every allowed and denied access is logged' invariant has no tamper-resistance today; a single UPDATE could erase evidence of an unauthorized access with no detection.
- **Scope:** In: REVOKE UPDATE, DELETE, TRUNCATE on audit_logs from the app role (AB-0012) + a BEFORE UPDATE/DELETE trigger that RAISEs. Out: hash-chaining and external anchoring (deferred, see §5).
- **Approach:** Migration: REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM abadge_app; CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql RAISE EXCEPTION; CREATE TRIGGER BEFORE UPDATE OR DELETE. Verified supported on PlanetScale Postgres.
- **Acceptance:**
  - As the app role, an UPDATE on any audit_logs row fails with insufficient privilege
  - As the app role, a DELETE on any audit_logs row fails
  - The immutability trigger raises if a privileged path attempts UPDATE/DELETE
  - INSERT into audit_logs still succeeds for the app role
- **Validation:** Integration test issuing UPDATE/DELETE/INSERT as the app role and asserting failure/failure/success.
- **Risk:** A legitimate code path that updates audit rows would break — none exists today (audit is insert-only); verified by grep before merge.
- **Files:** packages/db/migrations/*.sql
- **Refs:**
  - https://planetscale.com/docs/postgres/connecting/roles — PlanetScale supports GRANT/REVOKE on custom roles.
  - https://planetscale.com/docs/postgres/extensions — plpgsql supported; standard CREATE TRIGGER available.

### AB-0022 — Add regression tests pinning the audit-before-decrypt and atomic mount+audit invariants
- **Workstream/Category:** audit / new-impl
- **Severity/Confidence/Effort:** medium / high / M
- **Source:** new-from-first-principles
- **Problem:** The access pipeline's strongest properties — every denial is audited before raising, and mount reservation + allowed-audit are written in one transaction (pipeline.ts:466-498, 686-699) — are not pinned by explicit tests, so a future refactor could silently drop them.
- **Rationale:** Prevents a regression where a denied access stops being logged or a mount is granted without a matching audit row, which would void the product's core audit guarantee without any test failing.
- **Scope:** In: integration tests asserting audit rows for allowed/denied/expired on read and use, and that a forced audit-insert failure rolls back the mount reservation. Out: the hash-chain (deferred).
- **Approach:** Add tests that drive resolveAccess/resolveProfileAccess/redeemMount and assert audit_logs contents per outcome; use a transaction-fault injection (mock that throws on the audit insert) to assert the reservation is not persisted.
- **Acceptance:**
  - Test: denied read (no permission) writes exactly one denied audit row and no mount reservation
  - Test: allowed use writes one allowed audit row and one reservation in the same tx
  - Test: injected audit-insert failure leaves zero reservations and zero audit rows (rollback)
  - Test: expired permission writes a result='expired' row
- **Validation:** These tests run in the integration bucket (Postgres) and fail if the invariant is broken.
- **Risk:** Fault injection can be brittle — mitigated by injecting at the db.transaction boundary, not internals.
- **Files:** packages/trpc/src/server/routers/access/*.test.ts

### AB-0040 — Correct AGENTS.md: remove the deleted onboarding gate and fix the profile auto-seed description
- **Workstream/Category:** docs / docs
- **Severity/Confidence/Effort:** medium / high / S
- **Source:** audit-finding:W2
- **Problem:** AGENTS.md lists the 'Onboarding-complete gate' as a non-negotiable invariant referencing packages/trpc/src/server/onboarding-gate.ts and error ONBOARDING_INCOMPLETE, but the gate was deleted (init.ts:183, organizations.ts:120) and the file is gone. AGENTS.md also says organizations.create does NOT seed a profile, while it does (organizations.ts:297-302).
- **Rationale:** AGENTS.md is the stated source of truth for contributors and agents; false 'non-negotiable invariants' cause reviewers to enforce rules that no longer exist and erode trust in the document's accurate sections — dangerous for a security product.
- **Scope:** In: delete the onboarding-gate invariant section, correct the onboarding-flow and organizations.create descriptions, scrub ONBOARDING_INCOMPLETE references. Out: re-introducing the gate.
- **Approach:** Edit AGENTS.md to describe the current behavior (org create auto-seeds a default server_managed profile; no at-use/at-issuance onboarding gate); grep docs/ for stale ONBOARDING_INCOMPLETE and onboarding-gate references and fix mirrors in docs/ and apps/docs/.
- **Acceptance:**
  - AGENTS.md contains no reference to onboarding-gate.ts, the onboarding-complete gate invariant, or ONBOARDING_INCOMPLETE
  - AGENTS.md onboarding section matches the auto-seed behavior in organizations.ts
  - docs/ and apps/docs/ have no surviving stale references (grep clean)
- **Validation:** grep for 'onboarding-gate'/'ONBOARDING_INCOMPLETE' across repo returns only historical migration/comment context, not live invariants.
- **Risk:** None material; doc-only.
- **Files:** AGENTS.md, docs/ARCHITECTURE.md, docs/ERRORS.md, apps/docs/

### AB-0012 — Provision a least-privilege non-owner application DB role and switch the app connection to it
- **Workstream/Category:** infra / ops-runbook
- **Severity/Confidence/Effort:** high / high / M
- **Source:** new-from-research
- **Blocks:** AB-0020, AB-0011
- **Problem:** The app currently connects as the default PlanetScale postgres role, which is the table owner / near-superuser; it bypasses RLS and cannot be meaningfully REVOKE'd from its own tables, so neither audit append-only nor RLS can be enforced.
- **Rationale:** Append-only audit (AB-0020) and RLS (AB-0011) are both unenforceable while the app connects as an owner/superuser role; this role is the precondition for any DB-level control.
- **Scope:** In: create an abadge_app login role with NOSUPERUSER NOBYPASSRLS, owning nothing, granted only DML it needs; repoint the Hyperdrive binding / connection string to it. Out: the REVOKE and RLS DDL themselves (AB-0020/AB-0011).
- **Approach:** Use `pscale role` to create abadge_app; GRANT SELECT/INSERT/UPDATE/DELETE on application tables (then AB-0020 REVOKEs UPDATE/DELETE on audit_logs); keep DDL/migrations under a separate owner role used only by the migrator. Update apps/api/src/lib/db.ts + Hyperdrive config + secrets.
- **Acceptance:**
  - Application runtime connects as a role where rolsuper=false and rolbypassrls=false (verified via pg_roles query in a smoke test)
  - Migrations run under a distinct owner role, not the app role
  - All existing integration/e2e tests pass against the restricted role
- **Validation:** Smoke test asserting the runtime role's attributes; full test suite green under the restricted role.
- **Risk:** Under-granting privileges breaks runtime writes — mitigated by running the full e2e suite under the new role before cutover and keeping a rollback to the prior connection string.
- **Files:** apps/api/src/lib/db.ts, apps/api/wrangler.jsonc, packages/db/drizzle.config.ts, docs/DEVELOPMENT.md
- **Refs:**
  - https://planetscale.com/docs/cli/role — pscale role CLI creates/manages restricted Postgres roles.

### AB-0052 — Disable Hyperdrive query caching for authorization-sensitive reads
- **Workstream/Category:** infra / security-fix
- **Severity/Confidence/Effort:** high / medium / S
- **Source:** new-from-research
- **Problem:** Hyperdrive caches read-only SELECTs (default ~60s) with no automatic invalidation on writes. abadge's permission/session/agent-state checks are SELECTs (auth.ts, pipeline.ts), so a just-revoked permission or disabled agent could keep authorizing access for up to the cache TTL.
- **Rationale:** Prevents a bounded but real authorization-staleness window where a revoked agent or expired/deleted permission still grants secret access after revocation — unacceptable latency for a credential firewall's kill-switch.
- **Scope:** In: ensure authz reads (permissions, agent_sessions, agents enabled/revoked, items soft-delete) bypass the Hyperdrive read cache. Out: caching of immutable metadata.
- **Approach:** Either disable Hyperdrive caching globally for the binding (simplest; correctness over the small latency win) or mark authz queries uncacheable; verify whether postgres-js queries are being cached and confirm revocation takes effect immediately in a test.
- **Acceptance:**
  - After revoking a permission, the next agent access is denied with no stale-cache window (integration test against a Hyperdrive-like setup, or caching disabled and verified)
  - After disabling an agent, its next request is rejected immediately
  - Decision (global disable vs per-query) recorded in an ADR
- **Validation:** Integration test: grant, revoke, immediately assert denial; plus config review confirming caching posture.
- **Risk:** Disabling caching adds DB load/latency — acceptable for a security-critical API; revisit with targeted caching later.
- **Files:** apps/api/wrangler.jsonc, apps/api/src/lib/db.ts, docs/SECURITY.md
- **Refs:**
  - https://developers.cloudflare.com/hyperdrive/concepts/query-caching/ — Hyperdrive caches read-only queries (default 60s) and never auto-invalidates on writes.

### AB-0100 — Align Better Auth versions across the workspace
- **Workstream/Category:** supply-chain / bug-fix
- **Severity/Confidence/Effort:** medium / high / S
- **Source:** new-from-research
- **Problem:** Better Auth versions are skewed: root pins better-auth 1.5.6 and @better-auth/core 1.5.6, packages/auth requests ^1.6.2, and @better-auth/cli is 1.4.22. Mixed auth-library versions can resolve to divergent runtime behavior.
- **Rationale:** Version skew in the authentication library risks subtle session/CSRF/cookie behavior differences between what the API bundles and what packages/auth expects — auth bugs are security bugs and are hard to diagnose.
- **Scope:** In: pin a single Better Auth version (core + cli + better-auth) across all package.json files and the lockfile. Out: upgrading to a new major.
- **Approach:** Choose one supported version (verify against the CVE scan in AB-0101), set it identically in root, packages/auth, and the API; run bun install, typecheck, and the auth e2e flow.
- **Acceptance:**
  - better-auth and @better-auth/core resolve to one version across the workspace (bun why shows a single version)
  - Device-code login + session exchange e2e flow passes
  - No type errors after alignment
- **Validation:** bun why better-auth shows one version; auth e2e (login.ts device flow) green.
- **Risk:** A version bump could change auth behavior — mitigated by running the auth e2e flow before merge.
- **Files:** package.json, packages/auth/package.json, apps/api/package.json, bun.lock

### AB-0103 — Pin runtime dependencies above known-CVE thresholds
- **Workstream/Category:** supply-chain / security-fix
- **Severity/Confidence/Effort:** medium / high / S
- **Source:** new-from-research
- **Problem:** Three runtime deps declare floating semver ranges that can resolve to versions with High/Critical advisories: hono ^4.7.0 (CVE-2025-62610, JWT aud), @trpc/server ^11.0.0 (CVE-2025-68130, prototype pollution), effect ^3.13.7 (CVE-2026-32887, RPC AsyncLocalStorage cross-request leak). The vulnerable features are not currently used by abadge, but the ranges float into vulnerable territory.
- **Rationale:** A lockfile refresh or fresh install could pull a vulnerable version; pinning above the fix line removes the latent footgun cheaply, before someone wires up the affected feature (e.g. hono/jwt) and turns a non-issue into a live vuln.
- **Scope:** In: raise minimum versions to hono>=4.10.2, @trpc/server>=11.8.0, effect>=3.20.0 and refresh the lockfile; verify the effect bump doesn't touch RpcServer.toWebHandler/HttpApp.toWebHandlerRuntime. Out: better-auth (handled in AB-0100).
- **Approach:** Update the version constraints in the relevant package.json files, run bun install, typecheck, run unit+integration+e2e. Confirm via grep that hono/jwt and tRPC experimental_* callers remain unused.
- **Acceptance:**
  - Lockfile resolves hono>=4.10.2, @trpc/server>=11.8.0, effect>=3.20.0
  - grep confirms hono/jwt and tRPC experimental callers are still not imported
  - Full test suite (unit/integration/e2e) green after the bumps
- **Validation:** bun why / lockfile inspection shows resolved versions at or above the thresholds; CI green.
- **Risk:** The effect 3.13->3.20 minor jump could introduce behavior changes — mitigated by running the full suite and reviewing the effect changelog before merge.
- **Files:** package.json, apps/api/package.json, packages/*/package.json, bun.lock
- **Refs:**
  - https://github.com/advisories/GHSA-m732-5p4w-x69g — CVE-2025-62610: hono JWT middleware omits aud validation; fixed in 4.10.2.
  - https://github.com/advisories/GHSA-43p4-m455-4f4j — CVE-2025-68130: @trpc/server prototype pollution via experimental App Router callers; fixed in 11.8.0 (and 10.45.3).
  - https://www.cvedetails.com/cve/CVE-2026-32887/ — CVE-2026-32887: Effect RPC/web-handler cross-request context leak; fixed in 3.20.0.

### AB-0010 — Introduce a single org-scoped data-access layer as the primary tenancy control
- **Workstream/Category:** tenancy / refactor
- **Severity/Confidence/Effort:** high / high / L
- **Source:** audit-finding:U1
- **Problem:** Tenancy isolation depends entirely on manually repeated eq(organizationId, ctx...) clauses across ~20 query sites (e.g. items.ts:54,272,297; pipeline.ts:206). There is no choke-point; a single forgotten filter is a cross-tenant leak with no backstop.
- **Rationale:** Prevents the highest-blast-radius failure in a credential vault — one missed WHERE clause leaking another tenant's items/agents/permissions — by making it structurally impossible to query tenant tables without an org scope.
- **Scope:** In: a scoped repository/helper that wraps reads/writes of items, profiles, agents, permissions, audit_logs and always injects organizationId from the request identity. Out: RLS (AB-0011), non-tenant tables (auth/session).
- **Approach:** Add a scopedDb(orgId) factory in packages/trpc that returns org-bound query helpers for the five tenant tables; migrate routers/access pipeline to use it; add a Biome/lint rule (or a unit test scanning imports) that bans direct imports of those table objects outside the scoped layer.
- **Acceptance:**
  - All tenant-table reads/writes in routers + access pipeline go through the scoped layer
  - A lint rule or CI test fails if a router imports items/profiles/agents/permissions/auditLogs directly
  - An attempt to construct a scoped query without an orgId is a type error or throws
  - Existing cross-org isolation tests still pass
- **Validation:** Cross-org integration tests (agent of org A cannot read org B item) + the import-ban CI check.
- **Risk:** Large surface migration could miss a site — mitigated by the import-ban lint rule that makes bypass paths fail CI.
- **Files:** packages/trpc/src/server/scoped-db.ts, packages/trpc/src/server/routers/*.ts, packages/trpc/src/server/routers/access/pipeline.ts, biome.json
- **Refs:**
  - https://planetscale.com/blog/rls-sounds-great-until-it-isnt — PlanetScale recommends app-layer scoping as the primary tenancy control, RLS only as a backstop.

## P2

### AB-0050 — Add cursor pagination to items, permissions, and agents list endpoints
- **Workstream/Category:** api / new-impl
- **Severity/Confidence/Effort:** medium / high / M
- **Source:** audit-finding:D5
- **Problem:** Only GET /audit is paginated (schemas.ts:438-441,741-744); /items, /permissions, /agents, /profiles, /orgs return unbounded arrays.
- **Rationale:** A large org gets unbounded list payloads for items/agents/permissions — a latency, memory, and Worker-CPU foot-gun that degrades the dashboard and SDK as tenants grow.
- **Scope:** In: cursor pagination on items, permissions, agents (the high-cardinality lists). Out: orgs/profiles (low cardinality) unless trivial.
- **Approach:** Reuse the audit cursor pattern: add cursor+limit to the input schemas and {data,nextCursor} to result schemas; order by (createdAt,id); cap limit at 100; thread through SDK + web list hooks.
- **Acceptance:**
  - items/permissions/agents list endpoints accept cursor+limit and return nextCursor
  - limit is bounded at 100 server-side
  - SDK and web consume nextCursor for pagination
  - Listing N>limit items returns a stable, non-overlapping page sequence (test)
- **Validation:** Unit tests for cursor encoding/bounds + integration test paginating > limit rows without duplicates or gaps.
- **Risk:** Cursor instability under concurrent inserts — mitigated by ordering on an immutable (createdAt,id) tuple.
- **Files:** packages/core/src/schemas.ts, packages/trpc/src/server/routers/items.ts, packages/trpc/src/server/routers/permissions.ts, packages/trpc/src/server/routers/agents.ts, packages/sdk/src/client.ts

### AB-0030 — Adopt per-profile envelope encryption (wrapped DEK) for server-managed secrets
- **Workstream/Category:** crypto / security-fix
- **Severity/Confidence/Effort:** medium / high / L
- **Source:** audit-finding:U3 | new-from-research
- **Depends on:** AB-0001
- **Blocks:** AB-0031, AB-0033
- **Problem:** Every server-managed secret across every tenant is encrypted directly under one global ENCRYPTION_KEY (items.ts:225,456). All mature peers (Infisical, Vault, OpenBao) instead use envelope encryption with a per-tenant DEK wrapped by a root KEK; abadge is materially weaker here.
- **Rationale:** Gives each profile an independent AES-GCM nonce budget (relieves the global 2^32 ceiling in AB-0031), enables per-tenant crypto rotation, and makes a future KMS-backed KEK cheap to adopt (rewrap N DEKs, re-encrypt nothing). NOTE: it does NOT by itself contain an ENCRYPTION_KEY (env) disclosure — that requires moving the KEK to a separate trust domain (AB-0033). HKDF-from-the-same-master was rejected because a master disclosure deterministically derives every subkey, providing no containment.
- **Scope:** In: generate a random per-profile DEK, store it wrapped by the env KEK (AES-256-GCM key wrap, AAD-bound to org+profile), encrypt server-managed content under the DEK, with a scheme marker so existing direct-KEK rows still decrypt. Out: moving the KEK to KMS (AB-0033); ZK items (unaffected).
- **Approach:** Add profiles.serverWrappedDek (+ iv + scheme/version). On the first server-managed write in a profile, generate a 256-bit DEK and store it wrapped by ENCRYPTION_KEY; encrypt item content under the unwrapped DEK in-request. Tag new rows (serverKeyVersion>=3 or a keyScheme column) so decrypt selects direct-KEK (existing v2 rows) vs DEK-envelope (new rows). Mirrors Infisical's KEK -> wrapped-DEK -> AES-256-GCM shape.
- **Acceptance:**
  - A new server_managed item is encrypted under a per-profile DEK, not directly under ENCRYPTION_KEY (unit test)
  - Two profiles encrypting identical plaintext use independent DEKs (cross-profile decrypt fails)
  - Existing v2 direct-KEK rows still decrypt unchanged (regression test)
  - Rotating ENCRYPTION_KEY requires only rewrapping per-profile DEKs, with zero content re-encryption (rotation test)
- **Validation:** Crypto unit tests for DEK independence + round-trip for both schemes; a rotation test that rewraps DEKs under a new KEK and re-decrypts content unchanged.
- **Risk:** Envelope plumbing bug strands rows — mitigated by the scheme marker selecting the right path on decrypt and round-trip tests for both schemes; verified backup before the migration.
- **Files:** packages/crypto/src/server/encrypt.ts, packages/db/src/schema/profiles.ts, packages/trpc/src/server/routers/items.ts, packages/trpc/src/server/routers/access/pipeline.ts, packages/db/migrations/
- **Refs:**
  - https://deepwiki.com/search/how-does-infisical-derive-or-s_fc5da19f-ff80-4f75-8073-ef2cd94068f8 — Infisical: root KEK wraps an internal root key wrapping per-org/project AES-256-GCM DEKs.
  - https://www.rfc-editor.org/rfc/rfc5869.html — RFC 5869: bind context (org/profile id) via HKDF info; salt is for non-secret randomness independent of the IKM.

### AB-0031 — Bound and monitor AES-GCM random-IV usage per key, with a documented rotation ceiling
- **Workstream/Category:** crypto / security-fix
- **Severity/Confidence/Effort:** medium / high / M
- **Source:** audit-finding:D3
- **Depends on:** AB-0030
- **Problem:** Server-managed content uses AES-256-GCM with a random 96-bit IV (crypto/server/encrypt.ts:44). NIST SP 800-38D limits a single key to ~2^32 random-IV encryptions before IV-collision probability exceeds 2^-32; a GCM IV collision under one key is catastrophic (plaintext XOR leak + authentication-key recovery enabling forgery).
- **Rationale:** Without a per-key ceiling and rotation trigger, a high-write deployment can silently approach the unsafe IV-collision regime; per-org keys (AB-0030) raise headroom but do not remove the need for a bound.
- **Scope:** In: define a per-key max-encryptions ceiling well below 2^32 (e.g. 2^28), document it, and rotate (bump serverKeyVersion / re-derive) before reaching it. Out: switching the cipher to XChaCha20 (alternative considered, see ADR).
- **Approach:** Track per-org server-managed encryption counts (or estimate from row counts) and rotate K_org / master before the ceiling; document the ceiling in SECURITY.md; add an alert. Alternatively adopt XChaCha20-Poly1305 for server-managed content to make random nonces collision-safe to ~2^80 — decide in the crypto ADR.
- **Acceptance:**
  - SECURITY.md documents the per-key encryption ceiling and rotation trigger with the NIST citation
  - A monitor/alert fires before any key reaches the ceiling, OR the cipher is XChaCha20 with random 192-bit nonce (collision-safe without counting)
  - Rotation re-encrypts/re-derives without downtime and is covered by a test
- **Validation:** Doc review against NIST 800-38D; a test exercising the rotation path; alert wiring verified in staging.
- **Risk:** Counting encryptions on Workers is awkward — mitigated by the simpler XChaCha20 option which removes the counting requirement entirely.
- **Files:** packages/crypto/src/server/encrypt.ts, docs/SECURITY.md
- **Refs:**
  - https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf — NIST SP 800-38D caps random-IV GCM at 2^32 invocations per key for <=2^-32 collision probability.

### AB-0044 — Correct API docs to the actual error envelope and pagination contract
- **Workstream/Category:** docs / docs
- **Severity/Confidence/Effort:** low / high / S
- **Source:** audit-finding:D4
- **Depends on:** AB-0050
- **Problem:** The error envelope is flat {code,message,hint,meta} (v1.ts:115-149), not the {error:{code,message,details?}} some docs/plan describe, and only audit is paginated; API docs should reflect reality.
- **Rationale:** SDK consumers coding to a wrong error shape mis-parse failures (e.g. miss hint/meta), producing brittle integrations and bad error UX.
- **Scope:** In: update docs/API.md + docs/ERRORS.md + apps/docs to the {code,message,hint,meta} envelope and document which endpoints paginate. Out: changing the envelope itself.
- **Approach:** Document the four-field envelope with examples, the status mapping (v1.ts:87-113), and cursor pagination semantics for audit (and items/permissions/agents after AB-0050).
- **Acceptance:**
  - docs/API.md and docs/ERRORS.md describe {code,message,hint,meta} with a real example
  - Pagination section lists exactly which endpoints support cursor+limit
  - apps/docs mirrors the corrected contract
- **Validation:** Doc review against v1.ts; example payloads match a live response.
- **Risk:** None material; doc-only.
- **Files:** docs/API.md, docs/ERRORS.md, apps/docs/

### AB-0090 — Write the ENCRYPTION_KEY / server-key rotation runbook
- **Workstream/Category:** ops / ops-runbook
- **Severity/Confidence/Effort:** medium / high / M
- **Source:** new-from-first-principles
- **Depends on:** AB-0030
- **Problem:** serverKeyVersion is designed as a rotation/AAD epoch marker, but there is no documented procedure to rotate the server master key (or per-org subkeys from AB-0030) and re-encrypt affected rows.
- **Rationale:** On suspected ENCRYPTION_KEY disclosure the team needs a rehearsed, tested procedure to rotate and re-wrap without downtime; improvising key rotation during an incident risks data loss or extended exposure.
- **Scope:** In: a runbook covering master-key rotation, per-org subkey rotation (post AB-0030), serverKeyVersion bumping, and re-encryption batching. Out: ZK root-key rotation (already implemented via profiles.rotate).
- **Approach:** Document step-by-step rotation using the existing serverKeyVersion machinery + AB-0030 derivation; include a re-encryption batch script reference, validation queries, and rollback; rehearse against staging.
- **Acceptance:**
  - Runbook exists in docs/ with exact commands and validation queries
  - A staging rehearsal rotates a key and re-encrypts a sample org with zero failed decrypts afterward
  - Rollback path documented and tested
- **Validation:** Staging rehearsal signed off; post-rotation decrypt check passes for sampled rows.
- **Risk:** Rotation script bugs cause data loss — mitigated by dry-run, batching, and verified backups.
- **Files:** docs/SECURITY.md, docs/DEVELOPMENT.md, packages/db/src/roadmap-backfill.ts

### AB-0003 — Backfill existing server-managed items into the default profile (re-encrypt under bound AAD)
- **Workstream/Category:** permissions / refactor
- **Severity/Confidence/Effort:** medium / medium / M
- **Source:** audit-finding:W1
- **Depends on:** AB-0001
- **Problem:** After AB-0001, only NEW server-managed items carry a profileId; pre-existing rows keep profileId=NULL and remain uncovered by profile-level grants.
- **Rationale:** Without a backfill, profile grants stay silently partial for any org that created server-managed secrets before AB-0001 shipped, leaving an inconsistent authorization surface.
- **Scope:** In: a one-shot migration script that, per org, assigns NULL-profile server_managed items to the default server_managed profile and re-encrypts them so AAD binds the new profileId. Out: ZK items (already have profileId).
- **Approach:** Idempotent script in packages/db that, in batches, decrypts each NULL-profile server_managed item with sentinel AAD, sets profileId, re-encrypts with profileId-bound AAD at SERVER_AAD_MIN_VERSION, and updates the row in a transaction; dry-run mode first.
- **Acceptance:**
  - After running, no server_managed item in a bootstrapped org has profileId=NULL
  - Each migrated item decrypts correctly under the new profile-bound AAD
  - Script is idempotent (second run is a no-op) and logs a per-org count
- **Validation:** Run against a seeded DB snapshot; assert decrypt success pre/post and idempotency on re-run.
- **Risk:** Re-encryption touches every server_managed row — mitigated by batching, transactions, dry-run, and a verified backup before run.
- **Files:** packages/db/src/roadmap-backfill.ts, packages/db/src/schema/items.ts

### AB-0023 — Retire the dead singular audit_log table and its schema export
- **Workstream/Category:** schema / refactor
- **Severity/Confidence/Effort:** low / high / S
- **Source:** audit-finding:O1
- **Problem:** A legacy singular audit_log table is still defined (packages/db/src/schema/audit-log.ts) and re-exported (schema/index.ts:6) alongside the live plural audit_logs, but no application code references it (grep confirms only the schema file).
- **Rationale:** Two near-identically named exports (auditLog vs auditLogs) invite importing the wrong one and writing audit rows to a table nothing reads — a silent audit-loss foot-gun in exactly the subsystem that must never lose data.
- **Scope:** In: drop the audit_log table in a migration; delete schema/audit-log.ts and its export. Out: the live audit_logs table.
- **Approach:** Confirm the 0006 cutover already migrated data out of audit_log; add a DROP TABLE IF EXISTS audit_log migration; remove the schema file + export; run typecheck.
- **Acceptance:**
  - schema/index.ts no longer exports auditLog (singular)
  - A migration drops the audit_log table
  - Typecheck and tests pass with no references to the singular export
- **Validation:** grep shows no auditLog (singular) references; migration applies cleanly on a snapshot.
- **Risk:** Dropping a table is irreversible — mitigated by confirming 0006 migrated its data and taking a backup before the migration runs in prod.
- **Files:** packages/db/src/schema/audit-log.ts, packages/db/src/schema/index.ts, packages/db/migrations/*.sql

### AB-0041 — Drop the dead content_nonce column from items
- **Workstream/Category:** schema / refactor
- **Severity/Confidence/Effort:** low / high / S
- **Source:** audit-finding:W3
- **Problem:** items.content_nonce (schema/items.ts:28) is never written or read by application code; the ZK content nonce is prepended into the ciphertext string (crypto/client/items.ts:60-62).
- **Rationale:** Dead schema misleads readers into thinking the nonce is stored separately and invites a future bug that 'uses' the empty column; AGENTS.md mandates flagging dead code.
- **Scope:** In: drop column content_nonce via migration; remove from the Drizzle schema. Out: the prepended-nonce format (unchanged).
- **Approach:** Mirror migration 0011 (which dropped items_key_nonce): add a DROP COLUMN content_nonce migration and remove the field from schema/items.ts; typecheck.
- **Acceptance:**
  - items table has no content_nonce column after migration
  - Schema no longer declares contentNonce
  - ZK encrypt/decrypt round-trip still passes (nonce remains prepended in ciphertext)
- **Validation:** Migration applies on snapshot; ZK round-trip test green.
- **Risk:** If any unseen path reads it, drop would break — mitigated by grep confirming zero references before merge.
- **Files:** packages/db/src/schema/items.ts, packages/db/migrations/*.sql

### AB-0043 — Change agents.createdBy ON DELETE to SET NULL so agent lifecycle follows the org, not the creator
- **Workstream/Category:** schema / bug-fix
- **Severity/Confidence/Effort:** medium / medium / M
- **Source:** audit-finding:W4
- **Problem:** agents.createdBy has onDelete: cascade (schema/agents.ts:13-15), so deleting the creating user cascade-deletes their agents and (via FK) those agents' permissions, while items use onDelete: set null (schema/items.ts:19). Agents are documented as org-scoped, not user-scoped.
- **Rationale:** Removing/deleting an operator can silently destroy live agents and all their grants, an availability incident for running workloads; the inconsistency with items indicates the cascade is unintended.
- **Scope:** In: migrate agents.createdBy FK to ON DELETE SET NULL and make the column nullable. Out: changing agent ownership semantics or requireAgentOwnership logic.
- **Approach:** Migration altering the FK to SET NULL + column nullable; verify requireAgentOwnership (init.ts:199-229) tolerates a null createdBy (admins still manage; members lose member-only ownership path for orphaned agents — acceptable, document it).
- **Acceptance:**
  - Deleting a user sets createdBy=NULL on their agents instead of deleting the agents
  - Agents and their permissions survive creator deletion (integration test)
  - requireAgentOwnership handles createdBy=NULL without throwing for admins
- **Validation:** Integration test: create agent, delete creating user, assert agent + permissions persist and admin can still manage it.
- **Risk:** Member-created orphaned agents become admin-only to manage — acceptable and documented; covered by ownership test.
- **Files:** packages/db/src/schema/agents.ts, packages/db/migrations/*.sql, packages/trpc/src/server/init.ts

### AB-0101 — Add a dependency vulnerability scan to CI
- **Workstream/Category:** supply-chain / ops-runbook
- **Severity/Confidence/Effort:** medium / high / S
- **Source:** new-from-first-principles
- **Problem:** CI uses --frozen-lockfile (good) but has no vulnerability scan (no bun audit / advisory check in .github/workflows/ci-cd.yml), so a newly-disclosed CVE in a pinned dependency goes unnoticed.
- **Rationale:** A credential broker must learn about a CVE in its crypto/auth/runtime deps (e.g. @noble/*, better-auth, hono, drizzle, effect) before an attacker exploits it; today nothing surfaces advisories.
- **Scope:** In: a CI job running bun audit (or osv-scanner) that fails on high/critical advisories. Out: SBOM/signed releases (AB-0102).
- **Approach:** Add a CI step running the advisory scan against the lockfile; allowlist with documented justification for any unfixable transitive lows; wire it non-blocking first, then blocking on high/critical.
- **Acceptance:**
  - CI runs a vulnerability scan on every PR
  - The job fails on a high/critical advisory with no allowlist entry
  - Allowlisted exceptions carry an inline justification + expiry
- **Validation:** Introduce a temporary known-vulnerable dep in a draft PR and confirm CI fails; revert.
- **Risk:** Noisy transitive lows could block CI — mitigated by gating only on high/critical with a documented allowlist.
- **Files:** .github/workflows/ci-cd.yml

### AB-0011 — Add Postgres RLS as a defense-in-depth backstop behind a NOBYPASSRLS app role and tx-wrapped SET LOCAL
- **Workstream/Category:** tenancy / security-fix
- **Severity/Confidence/Effort:** medium / medium / L
- **Source:** audit-finding:U1
- **Depends on:** AB-0010, AB-0012
- **Problem:** Even with a scoped DAL (AB-0010), there is no database-enforced backstop; a bug in the scoped layer or a raw query would still leak cross-tenant.
- **Rationale:** Turns 'forgot to filter' from 'leaks rows' into 'returns zero rows' — but only if implemented without the fail-open trap that Hyperdrive's transaction pooling introduces.
- **Scope:** In: RLS policies on tenant tables keyed off current_setting('app.current_org'); a wrapper that opens a transaction and runs SET LOCAL app.current_org first for every scoped statement. Out: applying RLS to queries that cannot be tx-wrapped (must be migrated first).
- **Approach:** Provision RLS USING (organization_id = current_setting('app.current_org', true)::text) on items/profiles/agents/permissions; route every scoped query through a tx that issues SET LOCAL as statement 1; connect via the AB-0012 NOBYPASSRLS non-owner role; add FORCE ROW LEVEL SECURITY. Gate merge on a test proving a non-tx scoped query is rejected (not silently unfiltered).
- **Acceptance:**
  - With RLS on, a query carrying the wrong app.current_org returns zero tenant rows (integration test through Hyperdrive-like pooling)
  - The app connects as a role for which rolbypassrls=false and which is not the table owner
  - A scoped read executed outside a transaction is rejected by a guard rather than running unfiltered (fail-closed test)
  - p95 latency regression on item list < 15% vs pre-RLS baseline
- **Validation:** Integration test harness that sets a mismatched org and asserts empty results; a deliberate non-tx query test asserting rejection; latency benchmark.
- **Risk:** SET LOCAL outside a transaction is a no-op under Hyperdrive pooling → fails OPEN; mitigated by requiring tx-wrapping + a fail-closed guard and by treating RLS as backstop only after AB-0010 lands.
- **Files:** packages/db/migrations/*.sql, packages/trpc/src/server/scoped-db.ts, apps/api/src/lib/db.ts
- **Refs:**
  - https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/ — Hyperdrive transaction-pools connections and RESETs SET state on return; SET LOCAL only applies inside a transaction.
  - https://www.postgresql.org/docs/current/sql-createrole.html — superuser/BYPASSRLS roles bypass all RLS; default is NOBYPASSRLS.
  - https://planetscale.com/docs/postgres/connecting/roles — PlanetScale supports custom least-privilege roles; default postgres role is near-superuser/table owner.

## P3

### AB-0021 — Make unauthenticated-bearer audit dedup correct under Workers isolate ephemerality
- **Workstream/Category:** audit / bug-fix
- **Severity/Confidence/Effort:** low / medium / S
- **Source:** audit-finding:W6
- **Problem:** The unauth-bearer audit rate limiter is a module-level in-memory Map (auth.ts:129-150). On Cloudflare Workers each isolate has separate memory and isolates are ephemeral, so the '1 write per IP per 10s' cap is per-isolate, not global, contrary to the comment's implied guarantee.
- **Rationale:** Under a scattered-source probe across many isolates, audit-write amplification is only loosely bounded; the comment overstates the guarantee, which misleads future maintainers reasoning about DoS surface.
- **Scope:** In: either back the limiter with the existing RateLimitCounter DO, or correct the comment to state it is best-effort per-isolate. Out: redesigning rate limiting generally.
- **Approach:** Lowest-cost: amend the comment to 'best-effort per-isolate' and rely on the existing request-level rate-limit middleware for the hard bound. If a hard global bound is required, route the dedup through RateLimitCounter keyed by IP.
- **Acceptance:**
  - Either the comment accurately describes per-isolate best-effort behavior, or the dedup is DO-backed and a test shows a single audit write across two simulated isolates
  - The existing request rate-limit middleware still bounds unauth probe volume
- **Validation:** Code review of the comment change, or a DO-backed unit test if that path is chosen.
- **Risk:** Negligible; if DO-backed, adds a DO round-trip on the unauth path — acceptable since it is already the rejected path.
- **Files:** packages/trpc/src/server/auth.ts

### AB-0024 — Stream audit_logs to a second append-only sink (tamper-detection)
- **Workstream/Category:** audit / ops-runbook
- **Severity/Confidence/Effort:** low / medium / M
- **Source:** new-from-research
- **Depends on:** AB-0020
- **Problem:** Even with DB-level append-only (AB-0020), a sufficiently privileged insider with DB ownership could in principle still tamper; abadge has no second, independently-controlled copy of the audit trail.
- **Rationale:** Vault/OpenBao's documented tamper-detection strategy is running multiple audit sinks and comparing them, not hash-chaining; a divergence between the DB and an external append-only store is the practical tamper signal for the insider threat — far cheaper than Merkle anchoring.
- **Scope:** In: optionally mirror audit rows to an external append-only sink (e.g. an object store with retention lock or a log pipeline) and a comparison/divergence alert. Out: hash chaining + signed Merkle anchors (rejected for beta, see deferred).
- **Approach:** Add a best-effort async export of each audit row to a second sink; a periodic job compares row counts/hashes between the DB and the sink and alerts on divergence. Keep it non-blocking so a sink outage never blocks the request path.
- **Acceptance:**
  - Audit rows appear in the second sink within a bounded delay
  - A deliberate DB-side deletion is flagged by the divergence check (test in staging)
  - Sink unavailability does not block or fail user/agent requests
- **Validation:** Staging test deleting a DB audit row and asserting the divergence alert fires.
- **Risk:** A second sink adds ops surface — mitigated by making export best-effort and out of the request path.
- **Files:** packages/trpc/src/server/audit.ts, apps/api/src/, docs/SECURITY.md
- **Refs:**
  - https://developer.hashicorp.com/vault/docs/audit/best-practices — HashiCorp recommends running multiple audit devices and comparing them as the tamper-detection strategy.

### AB-0032 — Add key commitment to the server-managed AEAD envelope
- **Workstream/Category:** crypto / security-fix
- **Severity/Confidence/Effort:** low / medium / M
- **Source:** new-from-research
- **Depends on:** AB-0030
- **Problem:** AES-GCM and XChaCha20-Poly1305 are non-committing AEADs; in a multi-key system one ciphertext can be made to decrypt without error under multiple keys (partitioning-oracle class). After AB-0030 abadge becomes a genuine multi-key system.
- **Rationale:** Cheap insurance once per-profile DEKs exist: closes the theoretical partitioning-oracle vector before any decrypt-error oracle could be exposed. Low practical risk for beta (high-entropy keys, authz-gated decrypt, no current oracle) so it is not a blocker.
- **Scope:** In: add a key-commitment tag (e.g. HMAC/hash-of-key commitment, or a fixed-string padding committed under the key) to the server-managed envelope and verify it on decrypt. Out: ZK items (single root key per profile already; lower priority).
- **Approach:** On encrypt, compute a commitment = H(key || context) and store it alongside the ciphertext; on decrypt, recompute and constant-time compare before returning. Apply to the per-profile DEK envelope from AB-0030.
- **Acceptance:**
  - Decrypt rejects a ciphertext whose stored commitment does not match the key actually used
  - Round-trip encrypt/decrypt still succeeds for valid (key, ciphertext) pairs
  - Commitment check is constant-time
- **Validation:** Unit test constructing a multi-key collision attempt and asserting decrypt rejection; round-trip test for the happy path.
- **Risk:** Over-engineering for beta if deferred indefinitely — acceptable; tracked as P3 to land with the per-org rollout.
- **Files:** packages/crypto/src/server/encrypt.ts
- **Refs:**
  - https://www.usenix.org/system/files/sec21-len.pdf — Len-Grubbs-Ristenpart: AES-GCM and (X)ChaCha20-Poly1305 are non-committing; partitioning-oracle attacks exploit key multi-collisions.

### AB-0033 — Move the root KEK to a KMS / separate trust domain (deferred blast-radius fix)
- **Workstream/Category:** crypto / arch-decision
- **Severity/Confidence/Effort:** medium / medium / L
- **Source:** new-from-first-principles
- **Depends on:** AB-0030
- **Problem:** The server-managed root KEK (ENCRYPTION_KEY) lives in Worker env. An attacker with BOTH the env secret AND a DB dump can decrypt all server-managed secrets; per-profile DEKs (AB-0030) localize rotation but do not change this because the KEK still unwraps every DEK in the dumped DB.
- **Rationale:** Containing the env+DB double-compromise requires the KEK to live in a separate trust domain (KMS in a different cloud account), so DB disclosure plus Worker compromise still hits an IAM wall. Deferred because it adds cross-cloud IAM and a per-decrypt KMS round-trip that beta does not need.
- **Scope:** In: an ADR + implementation moving DEK wrap/unwrap to an external KMS (AWS/GCP) with EncryptionContext binding (org/profile/item). Out: beta delivery — trigger this before the first regulated/enterprise customer or when threat-3 enters scope.
- **Approach:** Because AB-0030 already stores wrapped DEKs, migration is rewrap-only: unwrap each profile DEK with the env KEK, rewrap via KMS.Encrypt with EncryptionContext, store; no content re-encryption. Bind IAM to the Worker identity; log Decrypt calls via CloudTrail (cross-cloud audit).
- **Acceptance:**
  - ADR recorded with the trigger condition and trade-offs
  - When implemented: DEK unwrap requires a KMS call that fails without the bound IAM identity (integration test in staging)
  - No server-managed content is re-encrypted during migration (only DEKs rewrapped)
- **Validation:** ADR review for beta; staging KMS integration test when the trigger fires.
- **Risk:** KMS latency/availability becomes a hard dependency for server-managed decrypt — mitigated by short-lived in-request DEK caching and KMS regional redundancy.
- **Files:** packages/crypto/src/server/encrypt.ts, docs/ARCHITECTURE.md, docs/SECURITY.md
- **Refs:**
  - https://deepwiki.com/search/how-does-infisical-derive-or-s_fc5da19f-ff80-4f75-8073-ef2cd94068f8 — Infisical supports an HSM/KMS-protected root KEK above the wrapped-DEK layer.

### AB-0091 — Add a structured-logging redaction guard for secret values
- **Workstream/Category:** ops / new-impl
- **Severity/Confidence/Effort:** low / low / S
- **Source:** new-from-first-principles
- **Problem:** No systematic guard prevents a future code path from logging a decrypted secret; today nothing logs secrets (verified by grep), but the protection is by-absence, not enforced.
- **Rationale:** Prevents a future regression where a debug log or error handler in the access/redeem path prints plaintext to Workers observability, which would be a silent persistent leak.
- **Scope:** In: a tiny logging helper that drops fields tagged secret + a test asserting access/redeem paths never pass plaintext to console. Out: a full observability framework.
- **Approach:** Add a log() wrapper that strips known secret-carrying keys; add a unit/integration test that spies on console during a reveal/redeem and asserts no plaintext substring appears.
- **Acceptance:**
  - A reveal/redeem integration test fails if a known plaintext value appears in captured logs
  - The log helper redacts tagged fields
  - No behavior change to non-secret logging
- **Validation:** Console-capture test around the reveal/redeem flow.
- **Risk:** Low; mostly preventive. Could be dropped if deemed speculative.
- **Files:** packages/trpc/src/server/, apps/api/src/

### AB-0080 — Remove deprecated SDK access methods at the v0.6 cut
- **Workstream/Category:** sdk-cli-mcp / refactor
- **Severity/Confidence/Effort:** low / high / S
- **Source:** new-from-first-principles
- **Problem:** AbadgeAgentClient.accessCiphertext/accessReveal/accessMount/bulkAccessMountEnv are @deprecated (slated for v0.6 removal) but still present, duplicating the unified access.read/use/redeemMount surface.
- **Rationale:** Carrying two parallel access surfaces invites integrators onto the dead path and doubles the maintenance/test burden on the most security-sensitive client API.
- **Scope:** In: remove the deprecated methods at the v0.6 boundary and update callers/docs. Out: changing the unified surface.
- **Approach:** At v0.6, delete the deprecated methods, update SDK docs and any internal callers (mcp/cli), and note the removal in the changeset.
- **Acceptance:**
  - Deprecated methods are gone from the SDK at v0.6
  - No internal caller references them
  - Changelog documents the removal
- **Validation:** Typecheck + grep for removed symbols returns no references; SDK tests pass.
- **Risk:** External integrators on the old methods break at v0.6 — acceptable at a documented major/minor cut with migration notes.
- **Files:** packages/sdk/src/client.ts, apps/docs/

### AB-0102 — Generate an SBOM and sign CLI release artifacts
- **Workstream/Category:** supply-chain / ops-runbook
- **Severity/Confidence/Effort:** low / medium / M
- **Source:** new-from-first-principles
- **Problem:** The CLI ships as a compiled binary (bun build --compile) via a release pipeline, but there is no SBOM or artifact signing, so consumers cannot verify provenance/integrity of the distributed binary.
- **Rationale:** An unsigned CLI binary that injects secrets into subprocesses is a high-value supply-chain target; signing + SBOM lets users detect a tampered or trojaned release.
- **Scope:** In: emit an SBOM on release and sign binaries (e.g. cosign/Sigstore) with published verification instructions. Out: reproducible builds (separate, harder effort).
- **Approach:** Extend the release workflow (see cli-release skill) to generate a CycloneDX SBOM and cosign-sign each binary + checksums; document verification in the CLI install docs.
- **Acceptance:**
  - Each release publishes an SBOM and a signature + checksum per binary
  - Documented verification command succeeds against a published release
  - CI fails the release if signing fails
- **Validation:** Verify a release artifact's signature using the documented public key in a clean environment.
- **Risk:** Key custody for signing adds ops burden — mitigated by using keyless Sigstore/OIDC signing.
- **Files:** .github/workflows/, apps/docs/cli/
