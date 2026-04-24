# abadge Production Readiness Remediation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Tracks use checkbox (`- [ ]`) syntax; fix-by-fix blueprints live under each track.

**Goal:** Bring `abadge` from "99/99 E2E-covered, 14 severity:high findings open" to "safely shippable to production" in a disciplined, verifiable order that does not regress already-clean surfaces.

**Architecture:** Remediation is partitioned into 9 production tracks (P0 → P5) ordered by risk-to-users: data loss first, authorization second, resource abuse third, availability fourth, contract compliance fifth, then reliability/observability/docs/tests/release. Each track produces an independently mergeable PR with tests and a rollout note.

**Tech Stack:** Bun · Turborepo · TypeScript strict · Hono on Cloudflare Workers · tRPC · Next.js App Router via OpenNext · Drizzle ORM · PlanetScale Postgres via Hyperdrive · Better Auth · Effect Schema · Biome.

**Sources of truth (both methodologically independent, minimal overlap):**

1. **E2E sweep** — `docs/superpowers/sweeps/2026-04-22-045119-d62266/state/REPORT.md` (iter 34, SATURATED), `state/issues.md` (245 findings, 241 open, 14 severity:high). Walked 99 plan cells across 10 surfaces checking **functional correctness** under normal use. Lives under `.claude/worktrees/dazzling-archimedes-53916c/`.
2. **Security audit** — `docs/security-audit/99-FINAL-REPORT.md` + `100-PRODUCTION-CHECKLIST.md` + `findings/{critical,high,medium,low,informational}/*.md` (139 findings: 3 Critical, 12 High, 25 Medium, 55 Low, 44 Info). 4 waves × ~27 parallel subagents reasoning about **adversarial exploit paths** — socket squatting, TOCTOU races, AAD substitution, OAuth pre-claim, audit omission. Lives under `.claude/worktrees/sleepy-pascal-324a1c/`.

Naming convention below:
- **`§code`** — E2E sweep umbrella codes (e.g., `§I5-RACE`, `§RL2`).
- **`W<wave><surface>-<N>`** — audit finding IDs (e.g., `W3P4-001`, `W1S7-001`). `C-1/C-2/C-3` are the 3 Criticals.
- **`AUDIT-Bn`** — plan-internal blocker IDs for audit-sourced items.

File:line pointers are verbatim from those artifacts and have been spot-checked where ambiguous.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Production blockers](#2-production-blockers)
3. [Non-blocking but important issues](#3-non-blocking-but-important-issues)
4. [Full issue list by category](#4-full-issue-list-by-category)
5. [Detailed remediation plan in execution order](#5-detailed-remediation-plan-in-execution-order)
6. [Final production readiness checklist](#6-final-production-readiness-checklist)

---

## 1. Executive summary

`abadge` is functionally complete but **not production-safe**. Two independent reviews converge on the same verdict:

- A 34-iteration **E2E sweep** walked all 99 plan cells across 10 surfaces and catalogued 245 distinct functional-correctness findings (14 severity:high).
- A 4-wave **adversarial security audit** dispatched ~27 parallel subagents across 12 pen-test threat classes and returned 139 findings: **3 Critical · 12 High · 25 Medium · 55 Low · 44 Info**.

Together they surface ~325 unique issues (after deduplication; ~10 overlap). The audit adds **2 net-new Criticals** the E2E sweep could not have found because they require adversarial reasoning, not cell-walking:

- **C-1 (W3P4-001):** MCP `run_with_secret` leaks plaintext secrets to the LLM for any secret longer than 4 KB — because redaction runs on a buffer capped *before* the secret has fully landed. Breaks the headline product invariant ("MCP NEVER returns plaintext to the LLM") for the exact secret classes that matter operationally (PEMs, kubeconfigs, SSH keys, multi-line JWTs).
- **C-2 (W3P12-001):** On any shared machine, a **same-UID** malicious process (compromised npm postinstall, IDE extension, dotfile) can squat the daemon's Unix socket path before the real daemon starts, and the CLI's `DaemonClient.send` does **zero peer verification** before sending `vault.unlock { masterPassword: "<plaintext>" }`. Captures the master password → full ZK-vault compromise for that user.
- **C-3 (COMPOSITE-001):** Cross-UID RCE chain on a shared host — TOCTOU on daemon socket chmod (W1S6-001) + unauthenticated `exec.*` RPCs (W1S6-003) + no peer-credential check (W1S6-005) → arbitrary code execution as the daemon UID.

The audit also identifies **cross-cutting themes** the sweep didn't frame as problems:

- **AEAD without AAD** (W1S7-001 + W1S7-002): both XChaCha20-Poly1305 and AES-GCM are called with no additional-data binding. Under database-write adversary assumptions, ciphertext rows can be swapped between items within a profile (ZK) and **cross-organization** (server-managed, since one global `ENCRYPTION_KEY` spans all orgs). A single fix — plumb `(orgId, profileId, itemId, contentVersion, keyVersion)` as AAD — closes two Highs and structurally hardens the whole crypto layer.
- **Audit-log omission is ~80% of failed-action paths.** The product invariant "every denied attempt is logged" is broken across 30+ branches in session-procedure routers, Better Auth plugin endpoints (8 hooks unwired), and the agent-authentication layer (unrecognized bearer tokens → no audit row). Insider action can proceed without forensic trace.
- **Better Auth plugin authorization bypass** (W3P8-001): admins can promote members to admin via `/api/auth/organization/update-member-role`, bypassing abadge's tRPC owner-only gate. Chains with W2T2-001 (admin invites owner) into admin → owner escalation.
- **OAuth pre-claim takeover** (W1S8-002): `requireEmailVerification:false` + missing `accountLinking` config means an attacker pre-registering a victim's email with a chosen password silently receives control when the victim next signs in via Google/GitHub.

The sweep terminated in SATURATED state (coverage complete); the audit terminated with a clear verdict: **DO NOT SHIP** until the 12 Week-1 blockers close. Combined **ship-gate is 27 blockers** across 6 tracks (23 from sweep-sourced + 4 new from audit-sourced; several overlap).

`abadge`'s cryptographic core, input validation, supply-chain hygiene, and external-auth boundary **are solid** (per audit §7): KDF, randomness, constant-time compare, library pins, zero postinstall hooks, strict tRPC schemas, Better Auth cookie posture, access-router permission ordering. The gaps are concentrated in **local trust** (MCP + daemon), **AEAD AAD plumbing**, **audit coverage on failed-action paths**, and **Better Auth plugin integration** — plus everything the E2E sweep already catalogued.

Of the 14 severity:high findings, several share single files (rate-limit middleware is 5-in-one, owner-role trio is 3-in-three-routes-same-predicate, envelope drift is cross-cutting). Bundled umbrella PRs cut the blocker count from 14-line-items to ~10 merge units.

**Critical exposures if shipped today:**

1. **Data loss class (sweep):** concurrent `rotateKey + items.create` permanently bricks the created item (§I5-RACE, catastrophic). First ZK rotation can brick *every* item in a profile via a schema bug (§I5). Non-opaque item kinds silently corrupt on decode (§I2).
2. **Cryptographic substitution class (audit):** both AEADs — XChaCha20-Poly1305 (ZK path, W1S7-001) and AES-256-GCM (server-managed path, W1S7-002) — run without additional-data binding. A DB-write-capable adversary can swap `ciphertext` + `encryptedItemKey` pairs between items in a profile (ZK) or across orgs (server-managed single global key), and decrypt returns the swapped plaintext under the wrong label. Closes with one `buildAad({orgId,profileId,itemId,keyVersion})` helper threaded through both paths.
3. **Local-trust class (audit, 2 Criticals + 1 composite):** MCP long-secret redaction bypass (C-1/W3P4-001) — any secret > 4 KB leaks up to 4 KB of plaintext to the LLM on first call, deterministic, single call. Daemon same-UID socket squat captures master password (C-2/W3P12-001) — any code running as the user's UID can intercept `vault.unlock { masterPassword: "<plaintext>" }`. Cross-UID daemon RCE chain on shared hosts (C-3/COMPOSITE-001) composes W1S6-001 + W1S6-003 + W1S6-005.
4. **Authorization class (sweep + audit):** sole org owners can self-lock-out (§OWN1/§OWN2); admins can mint owner-role invitations (§INV1a/W2T2-001 — cross-confirmed) and promote members to admin via Better Auth plugin endpoint (W3P8-001, **new from audit**, chains with W2T2-001 into admin→owner); multi-org users cannot bootstrap (§ORG2/§I4/§ORG2d); agents.revoke/rotate accept any member (W1S9-001, **new**); OAuth pre-claim takeover (W1S8-002, **new**); 8 Better Auth org-plugin lifecycle hooks unwired → silent state mutations + zero audit (W1S8-001, **new**).
5. **DoS class (sweep):** no HTTP body limit → 1 GB/min unauthenticated DoS (§DoS2); rate-limit bypass via `X-Forwarded-For` spoof (§RL2); cross-path rate-limit bucket contamination (§RL5); unauthenticated `createChallenge` unrate-limited + unbounded row growth (§R5 + §DoS1); 500 oracle + big-sig DoS on `exchangeSession` (§AUTH12); 750 KB plaintext crashes encode (§CRYPTO-EDGE1); scrypt pins Worker isolate at 3-4 concurrency (W2T9-003, **new**).
6. **Information leak class (sweep + audit):** every tRPC 4xx/5xx leaks stack + SQL + query params (§S1/§SEC4/W2T6-004); secret-bearing responses have no `Cache-Control: no-store` (W2T11-005, **new**); signup enumeration + password bounds mismatch (§AUTH5/§AUTH6); web app ships no CSP/HSTS/frame-ancestors (W1S2-001, **new** — mitigation cited by the product's own THREAT_MODEL.md is absent).
7. **Audit-coverage class (audit, cross-cutting):** ~80% of failed-action paths write no audit row, inverting the "every attempt logged" invariant. Unrecognized bearer tokens silent (W2T12-001, **new**). Denied-path branches (30+) silent (W2T12-003, **new**). `safeAuditInsert` throws invert caller safety (W2T12-002, **new**). Better Auth plugin state mutations silent (W1S8-001, **new**).
8. **Profile bootstrap race (audit):** `profiles.bootstrap` does SELECT-then-UPDATE without `WHERE wrappedRootKey IS NULL` — two concurrent admins bootstrapping the same profile silently orphan one wrap (W2T7-003, **new**).
9. **Contract drift (sweep):** 5 distinct error-envelope shapes across Hono/tRPC/better-auth/429 (§ENV2/§RL1/§AUTH9); SDK `AbadgeApiError` drops `issues` field (§SDK9); `/terms` + `/privacy` 404 behind register consent gate (§W17 — legal/compliance).
10. **User-flow dead ends (sweep):** fresh signup lands with 0 orgs (§ON6); profile detail buttons are unimplemented stubs (§W2); localStorage survives logout → user-B inherits user-A org (§W4); CLI cannot unlock ZK profiles for multi-org users at all (§O3).
11. **Environment fragility (sweep):** Next 15.5.14 turbopack RSC manifest bug 500s every HTML route without a permanent workaround (§W-STACK).

**Recommendation:** do **not** ship v1. Execute tracks P0, P0.5 (new — crypto AAD), P1, P1.5 (new — local trust), P2, P3, P3.5 (new — audit coverage) as blockers. Est. **3–4 engineer-weeks** disciplined (up from 2–3 with the original sweep-only plan). P4 (reliability + observability) and P5 (docs/tests/release) can ship with v1.1.

---

## 2. Production blockers

These must land before any production traffic. Each is characterized as **{What · Why · Risk · Root cause · Fix · Dep · Verify}**. Ordered by track.

### 2.1 Data integrity (Track P0 — must ship first)

#### B1. §I5-RACE — concurrent rotateKey ↔ items.create permanent data loss

- **What:** `profiles.rotateKey` reads all ZK items, re-wraps each DEK with the new root key, and updates `profiles.wrappedRootKey`/`keyVersion` atomically. There is no `SELECT … FOR UPDATE` on the items read-set and no CAS on `keyVersion`. A concurrent `items.create` (or `update`) can wrap a new DEK with the *old* root key, then land after the rotation commits. The new item's encryptedItemKey is unrecoverable.
- **Why:** catastrophic silent data loss on a happy-path concurrency collision. User cannot detect until a later decrypt fails.
- **Risk if unresolved:** real production data loss. Customers would require backup restore. Undetectable until impact.
- **Root cause:** Postgres READ COMMITTED default; no serializable txn; no advisory lock on `profileId`; no keyVersion CAS on item insert.
- **Fix:** in `packages/trpc/src/server/routers/profiles.ts:354-403`, wrap the rotate+rewrap block in a serializable-isolation transaction **and** acquire `pg_advisory_xact_lock(hashtext(profileId))` before any read. On item insert paths (`packages/trpc/src/server/routers/items.ts:106-124` for server-managed, and the ZK branch around `:60-80`), take the same advisory lock and assert `profiles.keyVersion === expectedKeyVersion` (passed by client in ZK) before insert; abort with `CONFLICT` if it advanced.
- **Dep:** none blocking; `pg_advisory_xact_lock` is standard Postgres.
- **Verify:** add a regression test at `packages/trpc/test/profiles-rotate-race.test.ts` that spawns 8 parallel `items.create` calls mid-rotate and asserts (a) every successful insert decrypts after rotation, (b) conflicting inserts error cleanly with `CONFLICT`. Test must fail against HEAD before the fix and pass after. Use a real Postgres via `@abadge/db` test harness, not a mock.

#### B2. §I5 — RekeyedItemSchema spurious `keyNonce` field bricks first rotation

- **What:** `RekeyedItemSchema` has a `keyNonce` field that ZK items do not use. Item-create and rotate both persist this column. On first rotation the mismatch persists across every ZK item in the profile, breaking decrypt.
- **Why:** first production rotation would brick every ZK item in the affected profile.
- **Risk if unresolved:** catastrophic data loss on rotation.
- **Root cause:** schema copy-paste from an earlier design iteration; ZK DEK is unwrapped with only `encryptedItemKey` + the profile root key — `keyNonce` is from the *content* nonce used inside the payload, not the DEK wrap.
- **Fix:** drop the `keyNonce` field from `RekeyedItemSchema` in `packages/core/src/schemas/items.ts`; write a Drizzle migration dropping the `key_nonce` column if present on `items`; audit `packages/trpc/src/server/routers/items.ts` and `profiles.ts` for any read/write of `keyNonce` and delete.
- **Dep:** B1 (land serializable rotation first — the migration touches the same table).
- **Verify:** round-trip test in `packages/trpc/test/rotate-item-roundtrip.test.ts`: create 5 ZK items, rotate key, decrypt each — all must match plaintext. Also migration dry-run via `bun run db:push` on a clone of PlanetScale staging shows the column drops cleanly.

#### B3. §I2 — non-opaque item kinds silently corrupt on decode

- **What:** `packages/trpc/src/server/item-payload.ts:3-41` hardcodes `parsed.kind === 'opaque'` check in `decodeServerManagedPayload`, so every other kind is routed through a branch that drops structured fields.
- **Why:** any non-opaque item (tokens, creds, connection strings) decrypts to wrong shape.
- **Risk if unresolved:** data corruption for typed items; silent until user notices the value is wrong.
- **Root cause:** first decoder was written assuming all items were opaque; never generalized.
- **Fix:** in `item-payload.ts`, use `ItemPayloadSchema` directly (Effect Schema decode union on `kind`); remove the string-matching branch; export a single `decodePayload(raw: Uint8Array): ItemPayload`.
- **Dep:** none; isolated decoder.
- **Verify:** `packages/trpc/test/item-payload.test.ts` must cover every `ITEM_KINDS` constant (api_key, token, password, etc.) round-trip through encode/decode with structured fields intact.

### 2.2 Authorization integrity (Track P1)

#### B4. §OWN1 + §OWN2 + §INV1a — owner-role integrity trio

- **What:** three routes each fail a shared predicate `canAssignOrTransferOwnerRole(ctx, targetRole)`:
  - `organizations.members.updateRole` at `packages/trpc/src/server/routers/organizations.ts:856-893` — sole owner can self-demote.
  - `organizations.members.remove` at `organizations.ts:798-854` (unconditional delete at L837) — sole owner can self-remove; org left zombie with stranded profiles.
  - `organizations.invitations.create` — admin can mint owner-role invite (vertical privilege escalation).
- **Why:** lockout + privilege escalation in one cluster.
- **Risk if unresolved:** customer orgs become unmanageable (support burden); admins can self-promote to owner via invite round-trip (breaks RBAC invariant).
- **Root cause:** three code paths with duplicated `if (targetRole === 'owner' ...)` logic, each missing the last-owner guard; no shared predicate.
- **Fix:** add `packages/trpc/src/server/auth/owner-guards.ts` exporting `canAssignOrTransferOwnerRole(ctx, {orgId, targetRole, actingRole})` and `countOwners(ctx, orgId)`. Wire all three routes to call it before mutation; throw `INVARIANT_OWNER_REQUIRED` (HTTP 409) if the operation would leave the org with zero owners or if the actor is not an owner and `targetRole === 'owner'`.
- **Dep:** none.
- **Verify:** `packages/trpc/test/owner-integrity.test.ts` — cover all 3 routes × {sole owner self-demote, sole owner self-remove, admin mints owner invite} = 3 deny cases + 3 positive cases (owner transfers to another member, then self-demotes; owner removes a non-owner; owner mints admin invite). Every deny must return the envelope `{code:'INVARIANT_OWNER_REQUIRED',message,hint,meta:{currentOwners,requiredMin}}`.

#### B5. §ORG2 + §I4 + §ORG2d — multi-org bootstrap trap

- **What:** `resolveSessionIdentityOptionalOrg` (the middleware claimed to be optional) throws `ORG_HEADER_REQUIRED` for any user with ≥2 memberships across `organizations.create`, `checkSlug`, `list`. Separately, `getInviteInfo`/`acceptInvite` at `packages/trpc/src/server/routers/organizations.ts:936,941` still run on `sessionProcedure` (requires pre-existing membership), so first-time invitees with zero memberships cannot accept. `init.ts:86-89` claims `organizations.list` is header-exempt but `auth-optional-org.ts:45-52` enforces it anyway (code contradicts its own docstring — §ORG2d).
- **Why:** users with ≥2 orgs cannot create more orgs or list theirs; users with 0 orgs cannot accept an invite to get their first org.
- **Risk if unresolved:** entire multi-org user journey is broken end-to-end; customers with teams cannot onboard.
- **Root cause:** middleware optimization added `memberships.length >= 2` branch as "require header" without excepting the bootstrap routes; invite routes bound to wrong procedure.
- **Fix:**
  - Rewrite `packages/trpc/src/server/middleware/auth-optional-org.ts:45-52` to return `{orgId:null, memberships}` when header absent *and* the route is in a small allowlist (`organizations.create`, `organizations.list`, `organizations.checkSlug`, `getInviteInfo`, `acceptInvite`). Otherwise, require the header.
  - Change `getInviteInfo` and `acceptInvite` at `organizations.ts:936,941` from `sessionProcedure` to `userProcedure` (which permits 0 memberships).
  - Delete the stale docstring at `init.ts:86-89` and replace with the new allowlist constant so code ≡ docs.
- **Dep:** none.
- **Verify:** `apps/api/test/multi-org-bootstrap.test.ts` and `packages/trpc/test/invite-accept-zero-memberships.test.ts` — user with 2 orgs can `organizations.create` a 3rd without header; user with 2 orgs can `list` without header; user with 0 memberships can `getInviteInfo({token})` and `acceptInvite({token})` end-to-end.

#### B6. §O3 — multi-org CLI cannot unlock ZK profiles (vertical slice)

- **What:** the CLI config has `activeOrgId` but never threads it into the tRPC client (`X-Abadge-Org-Id` header); the daemon has no `orgId` field on `DaemonAuthState`; the daemon's RPC calls that need scoping (`vault.unlock`, `item.decrypt`) therefore never pass org scope through to the API.
- **Why:** multi-org CLI users cannot unlock any ZK profile at all — unlock flow 400s on missing header.
- **Risk if unresolved:** CLI is unusable for anyone in more than one org.
- **Root cause:** org header plumbing designed for web, never wired through daemon.
- **Fix (6-file vertical slice):**
  - `packages/cli/src/config.ts` — ensure `activeOrgId` is persisted + loaded.
  - `packages/cli/src/trpc-client.ts` — `fetch` hook sets `X-Abadge-Org-Id: <activeOrgId>` when present.
  - `packages/daemon/src/rpc/types.ts` — add `orgId: string | null` to `DaemonAuthState` + `vault.unlock` params.
  - `packages/daemon/src/rpc/handlers/vault.ts` — thread `orgId` from unlock params into state.
  - `packages/daemon/src/rpc/handlers/item.ts` — pass `orgId` to tRPC calls via header.
  - `packages/cli/src/commands/vault/unlock.ts` — read `activeOrgId` and pass to `vault.unlock`.
- **Dep:** B5 (org-header middleware allowlist must stabilize first).
- **Verify:** CLI integration test `apps/cli/test/multi-org-unlock.test.ts` — 2-org user can `abadge vault unlock` their ZK profile in each org; audit trail records the correct `orgId` for each unlock.

### 2.3 DoS + rate-limit (Track P2)

#### B7. §RL1 + §RL2 + §RL3 + §RL4 + §RL5 — rate-limit middleware rewrite (single-PR umbrella)

- **What:** all five findings live in `apps/api/src/middleware/rate-limit.ts` (20 LoC). Summary:
  - §RL1: 429 response envelope violates `{code,message,hint,meta}`; no `Retry-After`/`X-RateLimit-*`.
  - §RL1.b: RFC 6585 §4 compliance gap.
  - §RL2: reads `cf-connecting-ip`/`X-Forwarded-For` without verifying Cloudflare-origin trust boundary — spoofable per-request to defeat the 100/min bucket in any deployment without Cloudflare strictly in front.
  - §RL3: when neither header is present, key is literal string `"unknown"` — all headerless clients share one bucket → trivial DoS of every other anonymous caller.
  - §RL4: counters are a module-level `Map<string,{count,resetAt}>` — per-isolate on CF Workers (limits are `N_isolates × 100/min`, non-deterministic) and never evict (unbounded memory growth per isolate; random-IP spoof → ~128 MB OOM in ~2.5M entries).
  - §RL5: buckets are keyed on IP alone, not `path:ip` — `/api/auth/*` (60/min) and `/trpc/*` (100/min) share one module-level Map → cross-path contamination (attack 1 endpoint to 429 another).
- **Why:** rate limiting is security infrastructure. Today it is cosmetic.
- **Risk if unresolved:** credential stuffing, enumeration, DoS on expensive endpoints.
- **Root cause:** middleware was written as a 20-LoC sketch, never hardened; single counter substrate for all buckets.
- **Fix:** rewrite `apps/api/src/middleware/rate-limit.ts` to (a) key `path:ip`, (b) trust proxy-set client IP only when `env.TRUSTED_PROXY === "cloudflare"` AND the request arrived over the Cloudflare edge (verify via `cf` object on `req.raw`), otherwise use the TCP-level remote address (`c.req.raw.cf?.clientIp` on Workers; `c.env.cf?.connectingIp` fallback); (c) use a Durable Object (`RateLimitCounter`) backing the counters so limits are cross-isolate-consistent and automatically evicted; (d) response: `{code:'TOO_MANY_REQUESTS',message,hint,meta:{retryAfter}}` with headers `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Durable Object code goes in `apps/api/src/durable-objects/rate-limit-counter.ts`; bind it in `wrangler.jsonc` as `RATE_LIMIT`.
- **Dep:** requires adding **one Durable Object** — an exception to the "no DOs" invariant in AGENTS.md. This is a correctness/security necessity, not infrastructure creep; document the exception in AGENTS.md alongside the fix. If user wants to keep the invariant, fallback is periodic pruning in the in-memory Map (fixes §RL3/§RL4 partially, keeps §RL4 non-determinism on Workers). Prefer DO; ask user if unsure.
- **Verify:** `apps/api/test/rate-limit.test.ts` — 6 tests: (1) path-scoping (/auth 60 + /trpc 100 independent), (2) XFF spoof rejected when not trusted-proxy, (3) cf-connecting-ip accepted when trusted-proxy, (4) headerless uses TCP IP (not "unknown"), (5) 429 envelope has all 4 fields + Retry-After, (6) DO counter survives isolate restart simulation. All 6 must fail on HEAD and pass after fix.

#### B8. §DoS2 — no global `bodyLimit`; 100 MB body accepted pre-auth

- **What:** Hono has no `bodyLimit` middleware; `/trpc/*` buffers the full request body before auth runs. A 100 MB signup body was accepted and stored in test.
- **Why:** at 100/min, this is 1 GB/min of unauthenticated write amplification.
- **Risk if unresolved:** trivial DoS + storage bloat.
- **Root cause:** Hono is lenient by default.
- **Fix:** add `bodyLimit({ maxSize: 1 * 1024 * 1024, onError: () => c.json({code:'PAYLOAD_TOO_LARGE',message:'request body exceeds 1MB',hint:'use smaller payloads',meta:{maxBytes:1048576}}, 413) })` at the Hono app root in `apps/api/src/app.ts`. Tune per-route via `bodyLimit` on specific routers if 1 MB is too tight (file uploads, if any). Note that the larger `ItemPayload` ceiling (see B9) is enforced at the Effect Schema layer on specific routes.
- **Dep:** none.
- **Verify:** `apps/api/test/body-limit.test.ts` — 1 KB body accepted, 2 MB body rejected with 413 envelope.

#### B9. §CRYPTO-EDGE1 — `toBase64` arg-spread stack overflow at ≥750 KB

- **What:** `packages/crypto/src/base64.ts` calls `String.fromCharCode(...bytes)` with a spread that exceeds `argv.length` limits around 750 KB on modern V8; any payload ≥1 MB reliably crashes.
- **Why:** any large item plaintext (e.g. PEM key, tar-packed config) crashes at encode time pre-request.
- **Risk if unresolved:** customer cannot store >750 KB secrets; error is a stack overflow, not a clean limit.
- **Root cause:** naive `String.fromCharCode(...arr)` for large arrays.
- **Fix:** chunked encode — loop with `fromCharCode.apply(null, bytes.subarray(i, i+8192))` and assemble. Also add `CreateItemSchema.payload` max-length constraint in `packages/core/src/schemas/items.ts` at (say) `MAX_PLAINTEXT_BYTES = 256 * 1024` to reject pathological payloads at the API boundary before they reach the crypto layer.
- **Dep:** B8 (bodyLimit must be in place first so the HTTP boundary is not the only guard).
- **Verify:** `packages/crypto/test/base64-large.test.ts` — 2 MB buffer round-trips without stack overflow; `packages/core/test/items-schema.test.ts` — `MAX_PLAINTEXT_BYTES + 1` rejected at decode with `VALIDATION_ERROR`.

#### B10. §R5 + §DoS1 — unauthenticated `auth.createChallenge` unrate-limited + unbounded row growth

- **What:** `auth.createChallenge` at `auth.ts:462-513` produces a 3-class enumeration oracle (§AUTH4) AND is not rate-limited (tested iter 8: 70/70 serial requests clean). Every call persists a row in `agent_session_challenges` with no reaper and no per-agent cap. Combined → ~5.8M unauth rows/day.
- **Why:** storage DoS + oracle in one endpoint.
- **Risk if unresolved:** DB bloat; reconnaissance of enrollment state for any agentId probe.
- **Root cause:** endpoint added without attaching to `/api/auth/*` rate bucket (it's on `/trpc/*`); no GC on challenges table.
- **Fix:**
  - Apply rate-limit to `auth.*` tRPC routes at 60/min (mirroring `/api/auth/*`) or add a lower per-agent cap (10/min per agentId).
  - Add cleanup: on every call, `DELETE FROM agent_session_challenges WHERE expiresAt < now()`. This is cheap and keeps the table bounded.
  - Collapse the 3-class oracle: return `200 { challenge?: ..., hint?: ... }` for both "enrolled" and "enrollment_required" cases, so timing + status match. The "not found" case collapses to the same shape after randomized-delay timing normalization.
- **Dep:** B7 (rate-limit middleware rewrite must land; also §AUTH4 collapse aligns with envelope work in B12).
- **Verify:** `apps/api/test/challenge-rate-and-gc.test.ts` — 11th call/agentId in a minute gets 429; old challenges purged on subsequent calls; oracle test: 100 requests for 50 real + 50 random agentIds — response body/status/timing indistinguishable within 2σ.

#### B11. §AUTH12 — exchangeSession sig-format 500 oracle + big-sig DoS

- **What:** `auth.exchangeSession` returns HTTP 500 on malformed-signature inputs (instead of 400) — a classification oracle. Also accepts arbitrarily large signature blobs before rejecting (big-sig DoS).
- **Why:** 500 is an oracle (signature was parseable vs not); big payload DoS.
- **Risk if unresolved:** enumeration channel + DoS.
- **Root cause:** §P1 pattern — `Effect.tryPromise({ try, catch: (e) => e })` rewraps domain errors as unknown → 500.
- **Fix:** B22 (§P1 helper `tryAsyncPreservingDomainErrors`) closes this as a side effect. Plus add `SignatureSchema` with `MaxLength(256)` bytes at `packages/core/src/schemas/auth.ts` so oversize sigs reject at validate, not after decode.
- **Dep:** B22 lands the cross-cutting helper; this fix just wires auth.exchangeSession to use it.
- **Verify:** `apps/api/test/exchange-session-oracle.test.ts` — malformed-sig returns 400 with `{code:'INVALID_SIGNATURE'}`, not 500; 10 KB sig returns 400 `VALIDATION_ERROR` within 5 ms.

### 2.4 Privacy + compliance (Track P3)

#### B12. §S1 + §SEC4 — stack / SQL / params leak on every tRPC 4xx/5xx

- **What:** `initTRPC.create({ isDev: true })` is effectively always on; the error formatter at `packages/trpc/src/server/init.ts:55` leaves `stack`/`query`/`parameters` on the wire. Live-confirmed iter 1, 20, 22 across tRPC-level 404, access.ciphertext 4xx, /trpc/* 500.
- **Why:** stack traces expose file paths, framework internals, and query text (incl. bind params).
- **Risk if unresolved:** reconnaissance + exploit surface; PII in queries could be exposed too.
- **Root cause:** dev-mode default wasn't env-gated for production.
- **Fix:** `isDev: env.ENVIRONMENT !== 'production'` in `initTRPC.create`. In `errorFormatter`, strip `stack`, `query`, `parameters`, `zodError` fields unconditionally in production. Ship a sealed `formatErrorForClient(cause, env)` helper with explicit allowlist of fields that *may* be exposed.
- **Dep:** none.
- **Verify:** `packages/trpc/test/error-formatter.test.ts` — production env: responses contain only `{code,message,hint,meta?}`; dev env: `stack` allowed. Integration test: trigger a deliberate DB error in dev, assert response body matches production envelope in prod mode.

#### B13. §ENV2 umbrella — error envelope compliance across all error paths

- **What:** 4 subs under §ENV2, each a different envelope shape:
  - §ENV2a: `parseErrorToValidationError` at `packages/trpc/src/server/errors.ts:...` is unreachable (dead code path); ValidationError never gets the designed envelope.
  - §ENV2b: `/api/auth/*` (Better Auth catch-all) emits bare `{message,code}` without `hint`/`meta` (§AUTH9-iter23).
  - §ENV2c: Hono 404 is plain text, not envelope.
  - §ENV2d: `ORG_MEMBERSHIP_REQUIRED` is 401 not 403 (wrong code class for authorization-vs-authentication).
- **Why:** AGENTS.md says "Error envelopes use `{code,message,hint,meta?}` — all four fields on every domain error." Code disagrees in 4+ places.
- **Risk if unresolved:** SDK consumers cannot rely on envelope shape → defensive parsing everywhere → bugs. And authorization-mode confusion for §ENV2d.
- **Root cause:** envelope invariant added after some error paths stabilized; retrofit incomplete.
- **Fix:**
  - Revive §ENV2a: teach `errorFormatter` in `init.ts` to detect `Effect.ParseError` and call `parseErrorToValidationError`.
  - §ENV2b: add a Hono middleware `apps/api/src/middleware/auth-envelope.ts` that wraps `/api/auth/*` responses; if the response is a 4xx and body is the bare `{message,code}` shape, re-wrap to `{code,message,hint,meta}`.
  - §ENV2c: `app.notFound((c) => c.json({code:'NOT_FOUND',message:'route not found',hint:'check /docs for API routes',meta:{path:c.req.path}}, 404))` in `apps/api/src/app.ts`; also `app.onError()` to catch bare Hono `HTTPException`s and re-envelope.
  - §ENV2d: change `ORG_MEMBERSHIP_REQUIRED` to 403 in `packages/core/src/errors.ts` and in its callsites.
- **Dep:** B12 (formatter must not leak in prod before we touch envelope shape).
- **Verify:** contract tests in `apps/api/test/error-envelopes.test.ts` probing each of: tRPC input validation, tRPC 404, tRPC UNAUTHORIZED, `/api/auth/signup` with bad email, Hono 404, Hono 500 — all responses parse as `{code,message,hint,meta?}`; 403 for authz, 401 for authn.

#### B14. §SDK9 — SDK `AbadgeApiError` drops `issues` field

- **What:** `AbadgeApiError` class in `packages/sdk/src/errors.ts` doesn't accept/expose `issues` (validation sub-errors). Server sends them; SDK silently drops.
- **Why:** SDK consumers cannot surface field-level validation errors to users; violates the documented SDK contract.
- **Risk if unresolved:** every SDK consumer reimplements validation error handling.
- **Root cause:** when `issues` was added to the API envelope, SDK class wasn't updated.
- **Fix:** ≤5-LoC — add `issues?: Issue[]` to the constructor params and class property; parse from response body. Update `packages/sdk/src/index.ts` type export; add to README.
- **Dep:** B13 (envelope must be stable first so `issues` arrive consistently).
- **Verify:** `packages/sdk/test/api-error.test.ts` — assert `issues` survives round-trip for a validation error.

#### B15. §W17 — `/terms` + `/privacy` 404 behind register consent (legal/compliance)

- **What:** register page consent sentence says "By registering you agree to our Terms and Privacy Policy" with links to `/terms` and `/privacy` — both routes 404.
- **Why:** legal/compliance gap — user forced to agree to policies they cannot view.
- **Risk if unresolved:** trust damage on a security product; potential legal exposure in regulated markets.
- **Root cause:** pages never created; links never removed.
- **Fix:** create `apps/web/src/app/terms/page.tsx` + `apps/web/src/app/privacy/page.tsx` with minimal real content (link to hosted policy, or inline minimum-viable policy drafted with legal review). If policies not ready: remove the consent sentence + links from register page (`apps/web/src/app/register/page.tsx`) and gate by "I acknowledge" instead.
- **Dep:** legal content source.
- **Verify:** curl `/terms` and `/privacy` return 200 with expected content; register page either links to real pages or does not mention terms/privacy.

### 2.5 Web-facing blockers (Track P3 cont.)

#### B16. §ON5 + §ON5b + §ON6 — new-user dead end

- **What:** three-link chain: (§ON6) Better Auth `afterSignUp`/`afterSignIn` hooks do not seed a personal organization — fresh signup lands with 0 orgs (contradicts AGENTS.md invariant "every user gets a personal org on first login"); (§ON5) when user picks server-managed in `/onboarding`, `organizations.create` at `packages/trpc/src/server/routers/organizations.ts:281-288` hardcodes `storageMode: 'zero_knowledge'` and ignores the request; (§ON5b) same insert omits `wrappedRootKey`, `kdfSalt`, `kdfParams`, `recoveryWrappedRootKey` — the profile is structurally unusable.
- **Why:** fresh signup cannot use the product.
- **Risk if unresolved:** 100% new-user activation failure.
- **Root cause:** onboarding flow coded before server-managed was fully wired; hooks never added.
- **Fix:**
  - `packages/auth/src/server.ts`: add `afterSignUp: async (user) => { await ctx.db.insert(organization).values({ ... }); await ctx.db.insert(profile).values({ orgId, storageMode, ... }); }`. Mirror on `afterSignIn` for idempotency.
  - `packages/trpc/src/server/routers/organizations.ts:281-288`: read `storageMode` from the request; only set the KDF/root-key fields when `zero_knowledge`.
  - Same site: if `zero_knowledge`, the request **must** include `wrappedRootKey`, `kdfSalt`, `kdfParams` — enforce via Effect Schema on `CreateOrganizationSchema`. Reject with `VALIDATION_ERROR` if missing.
  - `packages/trpc/src/server/routers/profiles/resolve-profile.ts:51-70` (orphan-adoption path): add storage-mode check — do not silently downgrade adopted server-managed profile to ZK.
- **Dep:** B5 (multi-org bootstrap must be stable first so we know the new org doesn't hit the trap).
- **Verify:** `apps/api/test/onboarding.test.ts` — fresh signup has 1 org + 1 profile with correct `storageMode`; server-managed flow creates a usable profile (items can be created + revealed); ZK flow fails validation without KDF fields.

#### B17. §W2 — profile-detail action buttons are unimplemented stubs

- **What:** `apps/web/src/app/profiles/[id]/page.tsx` renders 5 action buttons (`Change Password`, `Rotate Key`, `Delete Profile`, etc.) via `<KeyActionRow />`. The component has no `onClick` prop and no handler wiring — they render but do nothing.
- **Why:** blocks user's UI path to actions like rotate-key (interacts with §I5-RACE fix test plan — need UI reach to verify).
- **Risk if unresolved:** profile management is entirely click-but-nothing-happens.
- **Root cause:** UI scaffolded but action mutations never wired.
- **Fix:** add `onClick` prop to `KeyActionRow` in `apps/web/src/components/profiles/key-action-row.tsx`; implement `handleChangePassword`, `handleRotateKey`, `handleDelete` in `page.tsx` using `trpc.profiles.*.useMutation()`. Route ZK operations through the daemon client (same pattern as CLI vault).
- **Dep:** B1 (rotateKey must be race-safe), B16 (profiles must bootstrap correctly).
- **Verify:** Playwright test `apps/web/test/e2e/profile-detail-actions.spec.ts` — click each button, observe mutation fires + UI updates + server-side effect.

#### B18. §W4 — Zustand localStorage survives logout → cross-user org bleed

- **What:** `abadge-org` localStorage key (Zustand persist) is not cleared on signOut in `apps/web/src/components/nav-user.tsx:43-47`. User-B signing in on same browser inherits user-A's `activeOrgId`, sending `x-abadge-org-id: <user-A-org>` on subsequent tRPC calls.
- **Why:** tRPC backend `requireOrgRole` gates prevent actual data leak, but the request carries identity across users — header-leak of another user's org id is a privacy issue.
- **Risk if unresolved:** shared-device leak; confusing UX; org ID is sometimes sensitive.
- **Root cause:** Zustand persist not coupled to auth state.
- **Fix (one-line):** in `nav-user.tsx:43-47`, `handleSignOut`: call `useOrgStore.getState().clearActiveOrg(); queryClient.clear(); await signOut();`.
- **Dep:** none.
- **Verify:** Playwright test — user A logs in, selects an org; user A logs out; user B logs in on same browser; user B's first API call has no `x-abadge-org-id` header (or their own).

### 2.6 MCP trust boundary (Track P3)

#### B19. §RED1 — MCP `run_with_secret` redaction fundamentally bypassable

- **What:** `packages/mcp/src/tools/run-with-secret.ts` pipes subprocess stdout/stderr back to the LLM with a redactor. The redactor has 14+ bypass vectors (base64 chunking across buffer boundaries, hex, URL-encoded, emoji cipher, etc. — catalogued iter 5).
- **Why:** secrets can reach the LLM via any cooperative-or-incompetent subprocess.
- **Risk if unresolved:** breaks the core value prop of the MCP tool — "the LLM never sees the secret."
- **Root cause:** redaction by string matching is inherently weak; subprocess output should not flow to the LLM at all.
- **Fix:** drop the subprocess output pipe to the LLM entirely. `run_with_secret` now returns only `{ exitCode, durationMs, outputLineCount }` — no stdout/stderr text. If the agent needs output, they can configure a separate audit channel or an allowlisted post-processor. Document this in `docs/MCP.md` + release notes as an intentional capability reduction.
- **Dep:** none.
- **Verify:** `packages/mcp/test/run-with-secret.test.ts` — subprocess echoes secret; response has no output field; exitCode + durationMs still present.

### 2.7 Agent hardening (Track P3)

#### B20. §AGC1 umbrella — `agents.create` hardening (5 sub)

- **What:** 4 sub-bullets under §AGC1:
  - (a) no count cap on agents per org — trivially create 10k agents.
  - (b) metadata accepts 2 MB / 400-deep JSON trees.
  - (c) `public_key_session` + `publicKey` + `issueBootstrapToken:true` combination silently swallows one of them (ambiguous state).
  - (d) whitespace-only and zero-width-char names accepted.
  - (e) mirror in `auth.enrollAgent` (live iter 26).
- **Why:** agent abuse + audit-log noise + ambiguous state.
- **Risk if unresolved:** DB bloat, audit-log confusion, enrollment ambiguity.
- **Root cause:** hardening never applied to a route that was prototyped early.
- **Fix:**
  - `packages/trpc/src/server/routers/agents.ts` at `create`: count-check against `MAX_AGENTS_PER_ORG = 500`; reject with `AGENT_QUOTA_EXCEEDED`.
  - `packages/core/src/schemas/agents.ts`: `CreateAgentSchema.metadata` → Effect Schema `record(string(), unknown())` with `Schema.filter` limiting serialized length to 16 KB and JSON depth to 8.
  - Same schema: add `Schema.refine` that rejects the `public_key_session + publicKey + issueBootstrapToken:true` combo with a clear error (`AGENT_PUBLICKEY_OR_BOOTSTRAP_NOT_BOTH`).
  - Schema: `name` → `Schema.String.pipe(Schema.trimmed(), Schema.nonEmpty(), Schema.pattern(/^[A-Za-z0-9_-]+$/))` to kill whitespace + ZW.
  - Mirror all of the above in `auth.enrollAgent`.
- **Dep:** B13 (envelope stable so new error codes travel cleanly).
- **Verify:** `apps/api/test/agents-create-hardening.test.ts` with 6 cases covering each constraint.

### 2.8 Password + auth polish (Track P3)

#### B21. §AU1 — no password reset at all

- **What:** Better Auth config has `RESET_PASSWORD_DISABLED`; no `sendResetPassword` handler; `/api/auth/forget-password` returns auth-plugin-disabled error.
- **Why:** zero password-recovery path for users.
- **Risk if unresolved:** every forgotten-password is a support ticket + account-recovery via manual intervention.
- **Root cause:** email sender never wired.
- **Fix:** pick an email provider (Postmark / Resend / AWS SES); wire `sendResetPassword: async ({ to, link }) => provider.send(...)` in `packages/auth/src/server.ts`; enable the reset plugin; add `/reset-password/[token]/page.tsx` in web; document env var for provider key in `packages/env/src/server.ts`.
- **Dep:** email provider credentials.
- **Verify:** `apps/web/test/e2e/password-reset.spec.ts` — request reset for existing email → link arrives → reset → login with new password.

### 2.9 Web environment (Track P2.5)

#### B22. §P1 helper — `tryAsyncPreservingDomainErrors` (blocks §AUTH12 + 45+ sites)

- **What:** current pattern is `Effect.tryPromise({ try: () => f(), catch: (e) => e })` — which returns `unknown` and is caught by a generic 500 handler. 45+ call sites.
- **Why:** domain errors (validation, not-found, forbidden) get rewrapped as 500, creating 500 oracles (§AUTH12) and losing structured error info.
- **Risk if unresolved:** entire classification layer of HTTP status codes is unreliable; adversaries and monitors can't distinguish input errors from server bugs.
- **Root cause:** Effect.tryPromise was copy-pasted; no one noticed it collapsed the hierarchy.
- **Fix:** add `packages/trpc/src/server/effect/try-preserving.ts` exporting `tryAsyncPreservingDomainErrors<T>(fn: () => Promise<T>): Effect.Effect<T, AbadgeError>`; implement by testing `instanceof AbadgeError` in the catch branch and rethrowing, only 500-wrapping for unknown errors. Run codemod to replace all 45+ `Effect.tryPromise({try, catch})` callsites with the new helper.
- **Dep:** none.
- **Verify:** `packages/trpc/test/try-preserving.test.ts` — domain error passes through, unknown error wraps as 500; integration test re-asserts §AUTH12 closed.

#### B23. §W-STACK — keep Next 15.5.14 workaround permanent

- **What:** Next 15.5.14 turbopack RSC manifest bug means `next/dist/client/components/builtin/global-error.js` goes missing under bun `.bun` store; every HTML route 500s. Workaround applied during sweep: `rm -rf apps/web/.next` + add `apps/web/src/app/global-error.tsx` stub.
- **Why:** without the workaround, the entire web dashboard is unreachable.
- **Risk if unresolved:** any `bun install` or next-version upgrade re-breaks web.
- **Root cause:** upstream Next/turbo regression.
- **Fix:** keep `apps/web/src/app/global-error.tsx` in source (already committed-or-pending). Add a `predev`/`prebuild` step in `apps/web/package.json` scripts that clears `.next` before dev: `"predev": "rm -rf .next"`. File an upstream issue at vercel/next.js with the minimal repro. When Next ships a fix, delete the predev script + global-error stub and verify.
- **Dep:** none.
- **Verify:** `bun run dev` at apps/web green; `curl http://localhost:3000/` returns HTML (not 500).

### 2.10 Local-trust blockers (Track P1.5 — added from security audit)

This entire sub-section is net-new from the security audit; the E2E sweep did not exercise adversarial local-process scenarios. Three findings (two direct Criticals + one composite Critical) collapse one product invariant each.

#### B24. W3P4-001 / C-1 — MCP `run_with_secret` leaks long secrets to the LLM

- **What:** `packages/mcp/src/tools/run-with-secret.ts:24-35, 145-148` — `BoundedCapture` caps each subprocess stream at `PRE_REDACT_CAP_BYTES = 8192`. `redactSecret(text, secret)` uses `text.split(secret).join("[REDACTED]")` which requires the **full** secret bytes to be present in the captured buffer. For any secret with byte-length L > 8192 (or 4097 < L ≤ 8192 with any subprocess-emitted padding before the secret), `split` returns a one-element array with raw bytes → redaction is a no-op → `truncateOutput` returns up to 4 KB of **raw plaintext** to the LLM.
- **Why:** Breaks the headline product invariant "MCP NEVER returns plaintext secrets to the LLM" (AGENTS.md, docs/MCP.md:181-194) for the exact secret classes that matter operationally (PEMs, kubeconfigs, SSH keys, multi-line JWTs, TLS certs).
- **Risk if unresolved:** single-call plaintext leak of up to 4 KB (typically ≥50 lines of a PEM); sufficient for partial private-key recovery + credential pivoting. Deterministic on first call, no race.
- **Root cause:** the redaction architecture's 2× headroom assumption silently requires `L < PRE_REDACT_CAP_BYTES - MAX_OUTPUT_BYTES = 4096 bytes`, which is enforced nowhere in schema, DB, or API layer. `ItemPayloadSchema.fields` is `Schema.Record(Schema.String, Schema.Unknown)` with no `maxLength`; `serverCiphertext` is unbounded `text`; no request body-size middleware.
- **Fix (best):** In `packages/mcp/src/resolve-secret.ts`, after resolving the plaintext bytes, assert `Buffer.byteLength(secretValue, "utf8") <= MAX_OUTPUT_BYTES`; if not, throw `SECRET_TOO_LARGE_FOR_RUN_WITH_SECRET` before `spawn` is called. The MCP server cannot honestly guarantee redaction for secrets larger than the post-cap; refusing is the only safe behaviour. Long secrets MUST route to `mount_secret` (filesystem) instead. Also: update `docs/MCP.md:117-126` to document the long-secret case.
- **Defense-in-depth companion:** Fix `W3P10-001` (see B27 below) to disallow `envVarName` values on the daemon's reserved-keys blocklist — independent vector, same MCP boundary.
- **Dep:** none.
- **Verify:** `packages/mcp/test/run-with-secret.test.ts` — new test: subprocess `printf '%s' "$ABADGE_SECRET"` with a 9000-byte secret returns either (a) `SECRET_TOO_LARGE_FOR_RUN_WITH_SECRET` error OR (b) `stdoutLines = ["[REDACTED]"]`; **never** any prefix of the secret plaintext.

#### B25. W3P12-001 / C-2 — Daemon same-UID socket squat captures master password

- **What:** The CLI's `DaemonClient.send` (`packages/daemon/src/client.ts:36-69`) does `connect({ path })` and immediately writes the JSON-RPC frame. Zero verification: no `lstatSync`, no UID check, no mode check, no socket-identity pin, no challenge handshake. `ensureDaemonStarted` (`packages/cli/src/commands/daemon.ts:69-108`) considers any responsive process at the socket path to be the legit daemon. On first `abadge login`, CLI sends `auth.setSession { token: "<better-auth-bearer>" }` → squatter records. On first `abadge profile unlock`, CLI sends `vault.unlock { masterPassword: "<plaintext>" }` → squatter records. Squatter now holds master password → derives KEK → unwraps root key → decrypts every ZK item the user has access to.
- **Why:** The daemon is the product's "strongest trust boundary." A same-UID actor — any code already running under the user's UID (compromised npm postinstall, IDE extension, sandbox-escaped tool, pip package with postinstall, dotfile) — can silently become the daemon. The daemon's own socket-mode defences (0600) don't help because the attacker is already same-UID.
- **Risk if unresolved:** full vault compromise for that user. Master password + Better Auth bearer + wrapped root key ⇒ attacker holds everything needed to decrypt every ZK item offline.
- **Root cause:** defence never installed. No daemon-identity handshake; no peer-pubkey pin; no TOFU registration.
- **Fix:** TOFU keypair pin. On first daemon startup after `abadge login`:
  1. Daemon generates Ed25519 keypair; writes public key atomically (`writeFile(tmp) + rename`) to `~/.abadge/daemon.pub` (mode 0644). Private key lives in daemon process memory only.
  2. CLI records pubkey fingerprint (sha256 of pubkey bytes) in `~/.abadge/config.json` on first successful daemon contact.
  3. On every subsequent `DaemonClient.send`, CLI sends a 32-byte nonce as the first frame; daemon signs `nonce || socket-bind-time` with its private key; CLI verifies signature against the pinned fingerprint. If mismatch → abort with `DAEMON_IDENTITY_MISMATCH`, refuse to send any sensitive RPC, prompt the user to re-pin manually (SSH-host-key-change UX).
  4. Belt-and-suspenders: before `connect`, `lstatSync(socketPath)` and refuse if `(mode & 0o777) !== 0o600` or `uid !== process.getuid()` (blocks naive squatters that don't bother to chmod).
- **Dep:** none (but B26 daemon TOCTOU fix overlaps in the same files).
- **Verify:** `packages/daemon/test/identity-handshake.test.ts` — spawn a mock-socket listener without a valid keypair; CLI `DaemonClient.send(...)` must abort with `DAEMON_IDENTITY_MISMATCH` before sending any params. Separate test: after the real daemon starts, CLI calls succeed; after daemon restart with a new keypair, CLI aborts and prints the re-pin prompt.

#### B26. COMPOSITE-001 / C-3 — Cross-UID daemon RCE chain (W1S6-001 + W1S6-003 + W1S6-005)

- **What:** Three Highs compose into cross-UID RCE as the daemon UID on a shared host:
  - **W1S6-001 (TOCTOU):** `Bun.listen({ unix })` creates the socket inode under the process umask (default 0022 → mode 0755) *before* `chmodSync(0o600)` runs. `packages/daemon/src/server.ts:529-566`.
  - **W3P12-002:** the window is deterministic, not probabilistic, for an attacker using `inotify`/`fsevents` on `dirname(socketPath)`. Same file.
  - **W1S6-003:** `exec.env`, `exec.expandEnv` (non-ZK branch), `exec.mount` RPCs require **no auth, no unlock**. `packages/daemon/src/server.ts:342-436`.
  - **W1S6-005:** no `SO_PEERCRED` (Linux) / `getpeereid` (macOS) peer-credential check on accept. `packages/daemon/src/server.ts:529-557`.
- **Why:** daemon is the Tier-1 trust boundary. Different-UID local attacker on a shared host (co-tenant, CI runner, some Docker configs) wins the chmod-after-listen race with a file watcher, then invokes unauthenticated `exec.env` to `Bun.spawn` arbitrary commands under the daemon UID with daemon `process.env` inherited. RCE + in-memory root-key exfiltration.
- **Risk if unresolved:** Critical on multi-user hosts; N/A on single-user laptops; N/A on cloud deployment (daemon not deployed). Applies to self-hosted / dev-shell-server scenarios.
- **Root cause:** socket permissions applied non-atomically; exec RPCs added without middleware; no peer-credential verification layer.
- **Fix (apply ALL three):**
  1. **Atomic socket permissions** (closes W1S6-001 / W3P12-002): wrap `Bun.listen` with `const old = process.umask(0o077); try { Bun.listen(...) } finally { process.umask(old); }`. Post-listen `statSync(socketPath).mode & 0o777 === 0o600` invariant abort. Also `mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })` and post-mkdir stat-check (closes W3P12-003).
  2. **Gate all `exec.*` handlers on auth + unlock** (closes W1S6-003): top of `exec.env`, `exec.expandEnv`, `exec.mount`: `buildAuthHeaders(auth); requireUnlocked(vault);`. Introduce per-RPC ACL tag (`AUTH_REQUIRED`, `UNLOCK_REQUIRED`) so the dispatcher enforces uniformly. Strip `ABADGE_*` keys from child `process.env` before spawn.
  3. **Add peer-credential verification on accept** (closes W1S6-005): Linux `getsockopt(fd, SOL_SOCKET, SO_PEERCRED)`, macOS `getpeereid(fd, &uid, &gid)`. Reject and close any connection whose peer UID ≠ `process.getuid()` before any frame is read. If Bun socket FFI lacks this, switch to `node:net` `createServer` which exposes the fd.
- **Dep:** independent of B25 but both touch `packages/daemon/src/server.ts`; land B25 first so the pubkey file exists by the time peer-cred is enforced.
- **Verify:**
  - `packages/daemon/test/socket-perms.test.ts` — spawn daemon with `umask(0o022)`; assert `statSync(socketPath).mode & 0o777 === 0o600` synchronously after `startServer()` resolves.
  - `packages/daemon/test/exec-auth-gate.test.ts` — open raw socket, skip `auth.setSession`, call `exec.env`; assert JSON-RPC error `UNAUTHORIZED` and no `Bun.spawn` invoked.
  - `packages/daemon/test/peer-cred.test.ts` — simulate a different-UID connection (via test fixture); assert connection closes before any frame read.

#### B27. W3P10-001 — MCP `envVarName` smuggles past daemon `RESERVED_ENV_KEYS`

- **What:** MCP `run_with_secret` (`packages/mcp/src/tools/run-with-secret.ts:12-22, 135-142`) takes `envVarName: z.string()` with no validation and calls Node `spawn()` directly, bypassing the daemon's 26-entry `RESERVED_ENV_KEYS` blocklist at `packages/daemon/src/server.ts:45-90` (`LD_PRELOAD`, `GIT_SSH_COMMAND`, `NODE_OPTIONS`, `BASH_ENV`, `DYLD_INSERT_LIBRARIES`, etc.). Prompt-injected LLM → local code execution as the MCP UID with the operator's secret as the injected env var.
- **Why:** defence-in-depth against prompt injection; the allow-list exists on the daemon but is trivially bypassed when the MCP is the actual execution engine.
- **Risk if unresolved:** classic env-var LD_PRELOAD-style escape on the MCP-host process; secret value accessible via attacker-chosen env var.
- **Root cause:** blocklist exists in `packages/daemon` only; MCP spawn path never validates.
- **Fix:** export `validateEnvKey` (or the `RESERVED_ENV_KEYS` set) from `packages/daemon` or move it to `packages/core` (shared constants); call from `packages/mcp/src/tools/run-with-secret.ts` before `spawn`. Reject with `ENV_VAR_NAME_RESERVED`.
- **Dep:** none.
- **Verify:** `packages/mcp/test/env-var-name.test.ts` — each key in `RESERVED_ENV_KEYS` as `envVarName` → rejection; normal keys (e.g. `DATABASE_URL`, `MY_SECRET`) → accepted.

### 2.11 Cryptographic AAD plumbing (Track P0.5 — added from security audit)

Brand-new blocker track. Neither AEAD primitive binds ciphertext to its context; a single helper + plumbing pass closes two Highs and structurally hardens the entire crypto layer.

#### B28. W1S7-001 + W1S7-002 — AEAD AAD binding for both XChaCha20-Poly1305 and AES-256-GCM

- **What:**
  - **W1S7-001 (XChaCha20-Poly1305, ZK path):** `encryptItem`, `wrapRootKey`, `rekeyItem` at `packages/crypto/src/client/items.ts:21,29,52,59,81,86` and `packages/crypto/src/client/keys.ts:25,44` call `xchacha20poly1305(key, nonce)` with no AAD. Poly1305 authenticates only ciphertext bytes → DB-write adversary swaps `(ciphertext, encryptedItemKey)` columns between items in the same profile; `decryptItem` silently returns the substituted plaintext under the wrong label. Also enables `contentVersion` rollback.
  - **W1S7-002 (AES-256-GCM, server-managed path):** `serverEncrypt`/`serverDecrypt` at `packages/crypto/src/server/encrypt.ts:36-40, 60-64` call `crypto.subtle.encrypt({ name: "AES-GCM", iv })` with no `additionalData`. One global `ENCRYPTION_KEY` spans all orgs → DB-write adversary swaps `(server_ciphertext, server_iv)` rows **cross-organization** — full cross-org plaintext disclosure on normal `access.reveal`.
- **Why:** these are silent-corruption / silent-disclosure bugs that need only DB write access (compromised DB, insider DBA, accidental app-level swap). The product's threat model explicitly defends against this class.
- **Risk if unresolved:** ciphertext row substitution attacks. For server-managed the blast radius is all orgs with a single global key.
- **Root cause:** AEAD constructors can take AAD but the call-sites don't pass it. No structural reason not to bind context — it's gratis cost for both primitives.
- **Fix:** add a single AAD builder:
  ```ts
  // packages/crypto/src/shared/aad.ts
  export const buildContentAad = ({ profileId, itemId, contentVersion }) =>
    concatBytes(utf8("abadge-item-v1"), utf8(profileId), utf8(itemId), u32(contentVersion));
  export const buildDekWrapAad = ({ profileId, itemId }) =>
    concatBytes(utf8("abadge-dek-v1"), utf8(profileId), utf8(itemId));
  export const buildRootWrapAad = ({ profileId, keyVersion }) =>
    concatBytes(utf8("abadge-root-v1"), utf8(profileId), u32(keyVersion));
  export const buildServerAad = ({ orgId, profileId, itemId, keyVersion }) =>
    concatBytes(utf8("abadge-sm-v1"), utf8(orgId), utf8(profileId), utf8(itemId), u32(keyVersion));
  ```
  Thread these through every encrypt/decrypt call site. Bump `CRYPTO_VERSION` from 1 → 2. For existing ciphertext, implement **rewrap-on-read**: on decrypt failure with v2 AAD, retry without AAD (= v1); if v1 succeeds, re-encrypt with v2 AAD and write back in the same txn. Log migration progress; alert when `v1_remaining_count = 0`.
- **Dep:** B1 (rotateKey serialization) — AAD migration touches the same rows; land the race fix first so concurrent writes during rewrap-on-read don't race.
- **Rollout risk:** old ciphertext must remain decryptable during migration. The rewrap-on-read pattern is idempotent + back-pressured. Staging soak: decrypt every existing row at least once; after zero v1-remaining for 72h, remove the v1 fallback branch. Customer-communication plan required if operators choose a forced re-encrypt migration instead of rewrap-on-read.
- **Verify:**
  - `packages/crypto/test/items-aad.test.ts` — encrypt under `(P, itemA, v=5)`; attempt `decryptItem` with AAD reconstructed for `(P, itemB, v=5)` and separately `(P, itemA, v=4)`; assert **both** throw Poly1305 auth failures.
  - `packages/crypto/test/server-aad.test.ts` — encrypt under `(orgA, profA, itemA, 1)`; attempt decrypt with `(orgA, profA, itemB, 1)`; assert `OperationError`.
  - `packages/crypto/test/migration.test.ts` — pre-seed DB with v1 ciphertext; read → assert silent rewrap to v2 → second read returns v2 only.

#### B29. W2T7-003 — Atomic profile bootstrap with `WHERE wrappedRootKey IS NULL`

- **What:** `profiles.bootstrap` at `packages/trpc/src/server/routers/profiles.ts:210-250` does SELECT → check `profile.wrappedRootKey` → unconditional UPDATE by `id`. Two concurrent admins bootstrapping the same profile race — the loser's wrap silently overwrites the winner's, and any items encrypted under the first admin's root key become permanently orphaned.
- **Why:** silent data-orphaning. Equivalent to an unbounded version of §I5-RACE at bootstrap time.
- **Risk if unresolved:** orphaned ZK items. User-visible as "decrypt fails" long after the race.
- **Root cause:** classic TOCTOU in check-then-act. Missing `IS NULL` guard on the UPDATE.
- **Fix:** single atomic UPDATE:
  ```ts
  const updated = await ctx.db
    .update(profiles)
    .set({ wrappedRootKey, kdfSalt, kdfParams, recoveryWrappedRootKey, keyVersion: 1 })
    .where(and(eq(profiles.id, profileId), isNull(profiles.wrappedRootKey)))
    .returning({ id: profiles.id });
  if (updated.length === 0) throw new ConflictError({ code: "PROFILE_ALREADY_BOOTSTRAPPED", ... });
  ```
- **Dep:** none.
- **Verify:** `packages/trpc/test/profiles-bootstrap-race.test.ts` — create empty profile; issue two concurrent `profiles.bootstrap` with distinct `wrappedRootKey`; assert exactly one 200 + one `PROFILE_ALREADY_BOOTSTRAPPED` conflict; row matches the winner's salt.

### 2.12 Audit-coverage restoration (Track P3.5 — added from security audit)

The audit's largest single cross-cutting theme: ~80% of failed-action paths write no audit row, inverting the "every attempt logged" invariant. These are grouped because a shared `tryAuthorizeOrAudit` helper closes most of them.

#### B30. W2T12-001 — Unrecognized bearer token → no audit row

- **What:** `packages/trpc/src/server/auth.ts:397-413` — `resolveAgentIdentity` rejects with `UNAUTHORIZED` when neither `verifyAgentSessionIdentity` nor `verifyLocalAgentIdentity` matches; writes no audit row. `auditAgentSessionReject` exists (`auth.ts:96-119`) and fires for disabled/revoked/expired sessions but not for "no matching row" or legacy-API-key misses. Credential-stuffing against `/trpc/access.reveal` leaves zero forensic trace.
- **Why:** product invariant 8: "Every allowed and denied agent access attempt must be logged in audit_log." Broken for the most important denial class (authentication probes).
- **Risk if unresolved:** insider + external probes invisible; no detection for credential stuffing.
- **Root cause:** audit helper only wired for a subset of denial reasons.
- **Fix:** audit unrecognized-token rejections with `eventType: "agent.session_reject"`, `result: "denied"`, `meta: { reason: "unknown_credential", tokenPrefix: token.slice(0, 4) }` (never log full token). Extend `audit_logs` schema to allow null `organizationId`/`userId` (or use `"__unauth__"` placeholder per existing rows). Rate-limit audit writes to 1/IP/10s with `floodSuppressed: true` meta on bursts to prevent audit-log DoS.
- **Dep:** B13 envelope stable.
- **Verify:** `packages/trpc/test/audit-bearer-miss.test.ts` — spray 10 random bearer tokens against `/trpc/access.reveal`; assert ≥1 `agent.session_reject` audit row with `meta.reason="unknown_credential"` and `meta.tokenPrefix` (only).

#### B31. W2T12-002 — `safeAuditInsert` throw inverts caller safety

- **What:** `log*Audit` helpers at `packages/trpc/src/server/audit.ts:46-76` wrap inserts in `tryAsync` which re-throws. When used outside an explicit `db.transaction`, the data mutation has already committed → client sees 500 → no audit row. Contradicts the explicit design of `packages/auth/src/audit-hooks.ts:7-15` which built `safeAuditInsert` to absorb exactly this failure.
- **Why:** silent double-fault. A committed mutation with no audit row is the worst of both worlds — data changed, forensic record missing, client told it failed.
- **Risk if unresolved:** data-log divergence; compliance audits find writes without corresponding audit entries.
- **Root cause:** `tryAsync` semantics re-throw; audit helpers shouldn't.
- **Fix:** wrap `log*Audit`'s `tryAsync` with `.pipe(Effect.catchAll((err) => { console.warn("audit_write_failed", {err}); return Effect.void; }))` so callers never 500 on audit write failures. Separately add a dead-letter queue (or metric) for failed audit writes so they can be replayed.
- **Dep:** none.
- **Verify:** `packages/trpc/test/audit-write-failure.test.ts` — mock audit insert to throw; assert client still sees success for the primary mutation; warning logged.

#### B32. W2T12-003 — Denied / not-found / role-failed branches write no audit row (30+ sites)

- **What:** session-procedure routers only log allowed outcomes. Per audit survey, 30+ failure branches across `organizations.ts`, `profiles.ts`, `items.ts`, `agents.ts`, `permissions.ts`, `auth.ts`, `access.ts` return errors with no audit row. Contradicts `docs/SECURITY.md:212` + AGENTS.md invariant 8. `routers/access.ts:212-220` already has the correct pattern.
- **Why:** insider action can proceed without record; forensic blind spots in 30+ routes.
- **Risk if unresolved:** no detection for insider RBAC probing; post-incident forensics miss denied-attempt context.
- **Root cause:** audit writes inline at each call site, so omitting one is a copy-paste miss.
- **Fix:** introduce `tryAuthorizeOrAudit(check, auditMeta, onSuccess)` helper in `packages/trpc/src/server/init.ts` that writes a `denied` audit row before re-throwing the auth error. Codemod the 30+ call sites to use it. Mirror the pattern from `routers/access.ts:212-220`. Finding sites:
  - `permissions.ts:60-67, 92-99, 107-131, 148-160, 251-258, 274-281`
  - `agents.ts:217-223, 226-233, 280-288`
  - `items.ts:51-58, 224-232, 282-298`
  - `organizations.ts:462-470, 659-687, 698-706, 717-726, 776-784, 813-821, 871-879`
  - `auth.ts:262-300, 348-440, 697-699`
- **Dep:** B30 + B31 (audit write infrastructure must be safe first).
- **Verify:** `packages/trpc/test/audit-denied-coverage.test.ts` — one test per category (org role fail, item not found, permission check fail, agent ownership fail); each asserts exactly one `denied` audit row with correct `eventType`.

#### B33. W1S8-001 — Wire the 8 missing Better Auth org-plugin lifecycle hooks

- **What:** `packages/auth/src/server.ts:79-95` only wires `afterCreateOrganization` and `afterDeleteOrganization`. Eight other lifecycle endpoints (`/organization/update`, `update-member-role`, `remove-member`, `invite-member`, `accept-invitation`, `reject-invitation`, `cancel-invitation`, …) execute successfully but write no audit rows and skip abadge's `onMemberRemoved` cascade — live agent sessions + permissions survive plugin-path member removals.
- **Why:** two invariants broken: audit coverage + cascade completeness. Attacker (or routine admin action) via the plugin path sidesteps both.
- **Risk if unresolved:** member removed via Better Auth plugin retains an active agent session and every permission granted to that agent until expiry — worst case a 15-minute live window of unauthorized access after the org-level removal.
- **Root cause:** P0-2 remediation from the 2026-04-14 review was incomplete; only 2 of 10 hooks wired.
- **Fix:** create `packages/auth/src/audit-hooks.ts` with `buildOrgUpdateAuditRow`, `buildMemberRoleUpdateAuditRow`, `buildMemberRemoveAuditRow`, etc. Wire every `beforeUpdateOrganization` / `afterRemoveMember` / `afterUpdateMemberRole` / `afterCreateInvitation` / `afterAcceptInvitation` / `afterRejectInvitation` / `afterCancelInvitation` hook to:
  1. `safeAuditInsert` (from B31) inside a `db.transaction`
  2. Invoke `onMemberRemoved` for destructive events
- **Alternative:** if hook wiring proves brittle, override those plugin endpoints via `disableRoutes` to throw `NOT_IMPLEMENTED` and force all mutations through the abadge tRPC equivalents (which are already correctly wired).
- **Dep:** B31 (`safeAuditInsert` must be caller-safe).
- **Verify:** `packages/auth/test/plugin-hooks-coverage.test.ts` — for each of the 8 endpoints, POST a valid request via Better Auth handler; assert one audit row with correct `eventType` + (for destructive events) assert `onMemberRemoved` cascade ran.

### 2.13 Authorization-plugin + OAuth (Track P1 — extends owner-role trio)

These extend the existing owner-role trio (B4) and multi-org bootstrap (B5) blockers. Two **new** authorization bypasses the sweep didn't see plus the OAuth pre-claim.

#### B34. W3P8-001 — Better Auth admin → admin promotion bypasses tRPC owner-only gate

- **What:** `packages/auth/src/server.ts:78-96` registers the `organization` plugin with no `roles`/`ac` override. Better Auth's default `adminAc` grants `member: ["create","update","delete"]`; the only gate on `/api/auth/organization/update-member-role` is a "creator role" check that blocks touching owners or setting role=owner but **allows admin promoting member→admin**. abadge's tRPC `updateMemberRole` at `packages/trpc/src/server/routers/organizations.ts:856-893` correctly gates on owner only — but the plugin path bypasses it.
- **Why:** privilege escalation. Chains with B4 (admin invites owner via W2T2-001) → admin-controlled accomplice gets owner, then demotes the real owner. 
- **Risk if unresolved:** org takeover by any admin.
- **Root cause:** abadge registered the Better Auth org plugin without customizing its RBAC; the default permissions are too permissive for the product's model.
- **Fix:** override `adminAc`:
  ```ts
  import { createAccessControl, defaultStatements } from "better-auth/plugins/organization/access";
  const ac = createAccessControl(defaultStatements);
  const memberAc = ac.newRole({ member: [], invitation: ["read"] });
  const adminAc = ac.newRole({ member: ["create", "delete"], invitation: ["create", "cancel", "read"] });  // ← drop member:["update"]
  const ownerAc = ac.newRole({ member: ["create", "update", "delete"], organization: ["update", "delete"], invitation: ["create", "cancel", "read"] });
  ```
  Pass `ac` + `roles: { admin: adminAc, owner: ownerAc, member: memberAc }` to the `organization()` plugin constructor.
- **Alternative:** use Better Auth's `disableRoutes` to disable `/api/auth/organization/update-member-role` entirely, forcing all role changes through tRPC `updateMemberRole`.
- **Dep:** B4 (owner-role trio) — land the shared `canAssignOrTransferOwnerRole` predicate first; this fix just ensures the Better Auth path is denied.
- **Verify:** `packages/auth/test/plugin-rbac.test.ts` — admin calls `POST /api/auth/organization/update-member-role` to promote member→admin; assert 403. Member→owner (already blocked) stays 403. Owner→admin (existing path) still 200.

#### B35. W1S9-001 — `agents.revoke` / `agents.rotate` accept any org member

- **What:** both `rotateAgent` (`packages/trpc/src/server/routers/agents.ts:199-262`) and `revokeAgent` (`agents.ts:264-326`) gate only on `scopedSessionProcedure("agents:write")` (member role) and never call `requireAgentOwnership`. Any org member can rotate any other member's legacy-API-key agent (attacker receives a fresh working `abg_` key with original permissions) or revoke it (silent DoS). Asymmetric with `permissions.create/revoke` which DO call `requireAgentOwnership` (`permissions.ts:72-80, 287-295`).
- **Why:** broken ownership model. Any member can steal or sabotage any other member's agent.
- **Risk if unresolved:** agent hijacking within an org (any member → another member's secrets).
- **Root cause:** `requireAgentOwnership` helper exists (`packages/trpc/src/server/init.ts:132-162`) but wasn't wired into rotate/revoke. Admin/owner retain existing escape via `init.ts:139`.
- **Fix:** in both routes, after existing org-scope lookup, add:
  ```ts
  yield* tryAsync(() =>
    requireAgentOwnership(ctx.db, agentId, ctx.identity.userId, ctx.identity.organizationId, callerRole),
  );
  ```
- **Dep:** none.
- **Verify:** `packages/trpc/test/agents-ownership.test.ts` — member `bob` calls `agents.revoke`/`agents.rotate` on `alice`'s agent; assert `403 MEMBER_AGENT_OWNERSHIP`. Owner/admin still allowed.

#### B36. W1S8-002 — OAuth account pre-claim takeover

- **What:** `packages/auth/src/server.ts:43-46` sets `emailAndPassword.requireEmailVerification: false` (default) and omits `account.accountLinking` config. Better Auth's OAuth handler silently links a Google/GitHub login to any pre-existing credential user when the OAuth provider asserts `email_verified: true`. Attacker pre-registers `victim@gmail.com` with a chosen password; when victim later signs in with Google, they land **inside the attacker's account** — attacker retains password access.
- **Why:** classic pre-claim takeover. Trivially executed at low cost.
- **Risk if unresolved:** any user who eventually uses OAuth on a new provider can be hijacked if an attacker registered their email first.
- **Root cause:** defaults too permissive for a security product.
- **Fix:**
  ```ts
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    minPasswordLength: 12,
    maxPasswordLength: 1024,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => provider.send({ to: user.email, subject: "Verify", body: `Click ${url}` }),
  },
  account: {
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,  // the critical flag
      trustedProviders: [],
    },
  },
  ```
  Add a Better Auth `before` hook that aborts OAuth link when the existing user has `emailVerified: false`. Update `apps/web/src/app/(auth)/register/page.tsx` to surface the verification-email requirement.
- **Dep:** B21 (email provider must be wired for both verification + password reset).
- **Verify:** `packages/auth/test/oauth-preclaim.test.ts` — pre-seed unverified credential user with `victim@example.com`; mount Better Auth with mock OAuth provider returning that email + `email_verified: true`; assert either separate user created OR OAuth link refused.

#### B37. W1S9-003 — Last-owner stranding check (extends B4 owner trio)

- **What:** `removeMember` (`organizations.ts:798-854`) only checks admin role; `updateMemberRole` (`organizations.ts:856-893`) only checks owner role. Neither prevents removing or demoting the *last* owner, admin removing owner, or sole-owner self-removal. After either, `organizations.update`/`delete` both require owner → permanent org stranding, DB intervention only.
- **Why:** this is the structural counterpart to B4's §OWN trio. B4 fixes updateRole + remove + invite at the tRPC layer; this adds the last-owner-count check as a separate invariant.
- **Risk if unresolved:** orgs get stranded → customer support burden + data loss if cascade goes wrong.
- **Root cause:** missing `COUNT(owners)` invariant before destructive ops.
- **Fix:** in the shared `canAssignOrTransferOwnerRole` helper from B4, add `countOwners` check; reject with `LAST_OWNER_PROTECTED` when the operation would leave zero owners.
- **Dep:** B4 (shared predicate location).
- **Verify:** covered by `owner-integrity.test.ts` (B4's test file) — add two more cases: sole owner self-remove → deny; admin evicts sole owner → deny.

---

## 3. Non-blocking but important issues

These must not block v1 but must land in v1.1 (next 30 days). Grouped by theme.

### 3.1 Reliability / daemon hardening (P4)

- **§DMN5** (6 sub-bullets) — `exec.mount` FS hardening: umask races, symlink traversal check incomplete, cleanup timer does not sweep mounts on lock.
- **§DMN6** (5 sub) — JSON-RPC 2.0 conformance gaps (batch requests, notification responses, error-code ranges).
- **§DMN7** — unbounded per-connection buffer → 10 MB JSON-RPC line pushed RSS to 978 MB.
- **§DMN8** — no idle timeout + no connection cap → slowloris / FD leak to max-files.
- **§DMN9** (4 sub) — auto-lock edge cases: does not clear mounts, timer not reset on activity.
- **Fix class:** add `maxLineSize: 64 KB`, idle timeout 15 min, max concurrent connections 16, mount sweep on lock, separate per-connection line parser from RPC dispatcher.

### 3.2 Observability gaps (P4)

- **§AUDIT5** — dead code path in audit writer (`deliveryMode` never populated).
- **§AUD1** — audit log not indexed for org-scoped cursor pagination.
- **§AUD7** — audit-log dual-shape: both `actor_id` and `user_id` exported from `packages/db`, stale.
- **§A1** — MCP end-to-end cross-agent audit-log leak at SDK/tRPC.
- **Fix class:** single audit writer contract `writeAudit({orgId, actor, eventType, result, meta, ipAddress})` behind an interface; drop dual schema; add `(org_id, occurred_at DESC)` index.

### 3.3 Database (P4)

- **§DB1** — dual audit-table schemas both still exported (`packages/db/src/schema/audit.ts` + `audit-new.ts`).
- **§DB2** — `occurred_at_idx` unused; missing composite `(org_id, id DESC)` for cursor pagination.
- **§AG4** — no unique constraint on `(orgId, publicKey)` across agents; same pubkey can be registered twice.
- **Fix:** drop `audit-new.ts`; add migration for new indexes + unique constraint.

### 3.4 Security polish (P4)

- **§SEC11 umbrella** — KDF/server-AES hardening (5 sub-bullets):
  - `hashLength` must be `Literal(32)` not `number()`.
  - `kdfSalt` needs `MinLength(22)` per OWASP Argon2id.
  - KDF memory bounds at schema layer (reject memory: 1 and memory: 2^31-1 accepted today).
  - Server AES-GCM missing AAD `keyVersion:itemId` binding — rewrap-substitution attack theoretically possible.
  - Ambiguous decrypt error classification (§SEC11f).
- **§AUTH4** — `auth.createChallenge` 3-class oracle (addressed by B10).
- **§AUTH5 + §AUTH6** — signup enumeration dual-oracle (status + timing) and bounds 8-128 (docs say 8-72).
- **§AUTH7 + §AUTH8 + §AUTH9-iter7** — signup CRLF / name-DoS / empty-name validation drift.
- **§AUTH10 + §AUTH11** — signin IP-bucket rate limit has no account lockout; oracle on parse vs auth-fail.
- **§AGR1** — agent revoke is not idempotent (double-revoke writes duplicate audit).
- **§CORS1 umbrella** (3 sub) — ACAC leak on untrusted preflight; no Max-Age; no Expose-Headers.
- **§HDR1 umbrella** (3 sub) — no CSP; HSTS 180d (<OWASP 1y + no preload); no Cache-Control on auth routes + no Permissions-Policy.
- **§TSLASH1** — `/health/` returns 301 redirect (trailing-slash inconsistency).
- **§ENROLL1** — publicKey JWK validation gap in `auth.enroll`.

### 3.5 SDK refactor (P4)

- **§SDK4 + §SDK7 + §SDK8** — hand-rolled `SdkTrpcClient` type drifts from tRPC router types; refactor to `inferRouterInputs<AppRouter>` / `inferRouterOutputs<AppRouter>` closes all three.
- **§SDK10** — `AbadgeAgentClient.disconnect()` does not clear the session-refresh timer; subsequent `connect()` re-arms on top of the old timer.

### 3.6 CLI polish (P4)

- **§CLI1 umbrella** (3 sub) — help/docs drift: commands in code missing from `--help`; flags in `--help` not implemented.
- **§ORG6** — CLI emits plain errors instead of envelope hints (`AbadgeApiError.hint` not rendered).
- **§CLI-RUN-1** — `ABADGE_AUTH_TOKEN` silently ignored when `localAgents.cli` exists (priority ambiguity).

### 3.7 MCP polish (P4 / P5)

- **§M2** — mount persists after MCP death (no cleanup on kill); 3 sub-bullets added iter 22: no signal handlers, mtime-touch defeat, UID mismatch silent.
- **§MCP10** — config-shape mismatch between docs and code.

### 3.8 Testing debt (P5)

- **§TEST1 umbrella** (3 sub):
  - AGENTS.md documents wrong `bun test` command.
  - SDK tests orphan from turbo (not part of `bun run test` at root).
  - **Zero regression tests** for §I5-RACE / §SDK10 / §AUTH12.
- **Fix:** every blocker fix in section 2 ships with a regression test; `packages/sdk` added to turbo `test` pipeline; AGENTS.md corrected.

### 3.9 Release pipeline (P5)

- **§REL1 umbrella** (2 sub):
  - SDK public-on-npm publishes via separate tag workflow; no changesets discipline.
  - Private-pkg version drift (crypto 0.1.0, mcp 0.0.1) untracked.
- **Fix:** converge on single changesets flow; add `@abadge/sdk` to `changeset publish` with access:public.

### 3.10 Docs drift (P5 — shippable now, zero code risk)

- **§DOC1** — `docs/SECURITY.md` references a phantom 3rd auth method; Non-Goals incomplete.
- **§DOC2** (11 sub) — `AGENTS.md` audit_logs field list wrong (HIGH priority for accuracy).
- **§DOC3** (9 sub, HIGH) — `docs/API.md` documents an entire fictional `vault.*` namespace not in code.
- **§TM1** — missing threat-model section on metadata-plaintext disclosure.
- **§ENV1** — envelope-spec decoder drift.
- **§MCP8** — legacy-auth drift in `docs/MCP.md`.
- **Fix:** single docs-only PR; zero behavioral change. Can ship in parallel with any track.

### 3.11 Audit-sourced non-blocking items (P4 — from security audit)

These are Medium audit findings that do not elevate to ship-blockers but must close in v1.1. Grouped by the audit's own theme buckets.

#### 3.11.1 Daemon hardening (extends §3.1)
- **W1S6-004** — per-connection accumulator grows without bound (overlaps §DMN7); fix with `maxLineSize: 64 KiB` + idle `socket.timeout()` + per-UID connection cap in `packages/daemon/src/server.ts:527-549`.
- **W1S6-006** — `exec.mount` doesn't enforce 0600 on pre-existing file; fix with `openSync(path, "wx", 0o600)` (O_CREAT|O_EXCL) + post-write `chmodSync` + `statSync` invariant abort at `packages/daemon/src/server.ts:413-436`.
- **W1S6-010** — `vault.unlock` has no rate-limit or lockout; add per-profileId failed-attempt counter with exponential backoff (1s after 3, 5s after 5, 60s after 10) at `packages/daemon/src/server.ts:225-254`. Audit wrong-password attempts.
- **W3P5-001** — `exec.mount` files persist past `vault.lock`; lift mount-cleanup loop from `server.ts:572-579` into a helper; call from both `vault.lock` handler AND `close()` AND the auto-lock callback (extends §DMN9 — already listed in original §3.1).
- **W3P12-003** — socket parent dir `mkdirSync` has no explicit mode; `mkdirSync(parent, { recursive: true, mode: 0o700 })` + post-mkdir `statSync` abort at `packages/daemon/src/server.ts:517` (folded into B26 fix above).

#### 3.11.2 Authentication hardening
- **W1S8-003** — password change doesn't revoke other sessions; set `emailAndPassword.revokeSessionsOnPasswordReset: true` in `packages/auth/src/server.ts:43-50`; add "Sign out of other sessions" button in `apps/web/src/app/(dashboard)/settings/page.tsx` calling `authClient.revokeOtherSessions()`.
- **W1S8-004** — server password policy is default 8 chars (UI enforces 12 client-side only); set `minPasswordLength: 12, maxPasswordLength: 1024` in `packages/auth/src/server.ts`; register `haveIBeenPwned` plugin from `better-auth/plugins`.
- **W1S8-005** (Low, but pairs with above) — removed members retain valid sessions; invalidate on `onMemberRemoved` cascade.

#### 3.11.3 Rate-limit + DoS (extends §3.4)
- **W2T9-003** — Better Auth scrypt pins Worker isolate (~32 MiB V-array, 3-4 concurrent = OOM); add per-isolate semaphore capping concurrent scrypt to 2–4 (503 the rest); adopt Workers Rate Limiting binding keyed by `${ip}:${path}` at 6/min/IP on password endpoints; WAF rule denying >10/min/IP on `/api/auth/sign-{up,in}/email`.
- **W1S6-010** — (listed above under daemon) unlock rate-limit.

#### 3.11.4 Audit-log integrity polish
- **W1S9-002** — `audit.listForAgent` leaks the creator's entire audit trail (not just the agent's). In `packages/trpc/src/server/routers/audit.ts:152-182`, change filter from `userId: ctx.identity.agentUserId` to `eq(auditLogs.agentId, ctx.identity.agentId)`. Drop the `userId` filter entirely from the agent path.

#### 3.11.5 Web headers (extends §3.4 HDR1)
- **W1S2-001** — add global CSP (`default-src 'self'; frame-ancestors 'none'; form-action 'self'`), HSTS (`max-age=63072000; includeSubDomains; preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(), geolocation=()` in `apps/web/next.config.ts`. **This is the mitigation THREAT_MODEL.md cites for Tier-2 XSS — its absence is the single largest web-hardening gap.**
- **W2T11-001** — HSTS header missing on apps/api; add via `secureHeaders()` Hono middleware.
- **W2T11-003** — Referrer-Policy not set to strict-origin-when-cross-origin or stricter.
- **W2T11-004** — COOP/COEP/CORP/Origin-Agent-Cluster missing.
- **W2T11-005** — **tRPC responses carry no `Cache-Control: private, no-store` on secret-bearing routes.** Fix at `packages/trpc/src/server/fetch.ts:7-19` by adding `responseMeta() => ({ "Cache-Control": "private, no-store, max-age=0, must-revalidate", Pragma: "no-cache", Expires: "0" })`. Same for Better Auth catch-all in `apps/api/src/index.ts`.

#### 3.11.6 API errors + envelopes (extends B12/B13)
- **W2T6-004** — extends §S1/§SEC4: specifically, `NODE_ENV` not set to `production` in `wrangler.jsonc` → `initTRPC` defaults `isDev: true` → `data.stack` shipped. **Also** `toTrpcError` passes raw `cause.message` → Postgres constraint names leak (e.g. `profiles_organization_id_name_unique`). Fix in `packages/trpc/src/server/errors.ts:73-79` by returning generic `"Internal server error"` for non-domain errors in production. Folded into B12 fix.

#### 3.11.7 Races (extends §3.1)
- **W2T7-001** — `access.*` revocation race: permission check + decrypt not transactional; a concurrent `permissions.revoke` DELETE between permission lookup and audit insert lets the in-flight call return plaintext after revoke commits. Fix in `packages/trpc/src/server/routers/access.ts:102-128, 327, 351, 367-378` by wrapping check + re-check + audit insert in one `db.transaction`; re-query the permission row inside the tx immediately before audit insert. Optionally `SELECT FOR UPDATE`.
- **W2T7-002** — `agents.revoke` cascade doesn't abort in-flight access; in the access-audit transaction (W2T7-001 fix), JOIN `agents` and re-assert `revokedAt IS NULL AND enabled = true` before writing the audit row; roll back if not.
- **W2T7-007** — CLI `mount` doesn't enforce 0600 on existing `--path`; same pattern as W1S6-006 — `openSync(path, "wx", 0o600)` + explicit `chmodSync` + `statSync` invariant abort at `packages/cli/src/commands/mount.ts:21-23`. Share helper with daemon (W1S6-006).

#### 3.11.8 MCP hardening (extends §3.7)
- **W3P10-001** — `envVarName` bypasses daemon's reserved-keys blocklist (LD_PRELOAD, NODE_OPTIONS, etc.) — **elevated to blocker B27** above.
- **W3P11-001** — `activeMounts` Map has no size cap; enforce `MAX_ACTIVE_MOUNTS = 64` per process.
- **W1S5-003 + W1S9-002** — `get_audit` scope not narrowed to agent's own rows only; clamp filter.

#### 3.11.9 DB schema polish (extends §3.3)
- **W1S9-005** — dead `audit_log` (singular) table still in schema; remove migration.
- **W1S9-006** — items CHECK constraint missing: exactly one of `{ZK columns, SM columns}` populated (defense-in-depth for mode-confusion family).
- **W1S9-009** — `member` table missing `UNIQUE(orgId, userId)`.
- **W2T9-007** — no expired-row cleanup job for `agent_session_challenges`, `agent_enrollment_tokens`, `agent_sessions`; add Cloudflare Cron Trigger nightly `DELETE ... WHERE expires_at < now() - INTERVAL '1 hour'`.

#### 3.11.10 CLI polish (extends §3.6)
- **W1S4-001** — `abadge mount` writes directly via `writeFileSync` rather than routing through daemon (contradicts documented flow); route through daemon's `exec.mount` RPC (which is now auth-gated per B26).
- **W1S4-002** — `abadge run` forwards parent env to wrapped subprocess by default; default should be sanitized env with an explicit `--pass-env KEY` allowlist.
- **W1S4-003** — `--token-stdin` not rejected on TTY (parallels the existing `--value` TTY guard).
- **W1S4-004** — `~/.abadge` parent dir mode not enforced on existing dirs, only new.
- **W1S6-011** — daemon's reserved env keys list missing several exploit vectors (PERL5LIB/OPT, RUBY*, JAVA_TOOL_OPTIONS, _JAVA_OPTIONS, CLASSPATH, LUA_*, TCLLIBPATH); expand allowlist.

#### 3.11.11 Environment + supply chain
- **W1S10-001** — one `latest` specifier on a production runtime dep; pin.
- **W1S10-002** — GitHub Actions pinned to tag rather than commit SHA; pin to SHA.
- **W1S11-001** — `DATABASE_URL` read but not declared in `packages/env/src/server.ts` schema.
- **W1S11-004** — `.env.example` placeholder accepted by validation (no "placeholder-reject" check).
- **W1S8-008** — `getTrustedOrigins` uses dev-mode posture in CORS allowlist; production should not auto-inject localhost.
- **W2T11-006** — CORS `allowMethods` not scoped to actual used methods.
- **W2T11-007** — preflight CORS `max-age` not set.
- **W1S1-003** — Better Auth `openAPI()` plugin possibly enabled in production; disable or gate behind auth.

#### 3.11.12 Coverage gaps flagged by audit
- **W2T4 (session lifecycle)** — audit agent hit usage limit after filing 3 Low findings; recommend re-run to close the 3 Low items (bearer-fallback no-expiry-filter, Better Auth token plaintext in daemon cache, device-code token exchange not atomic).
- **W3P3-001** — Better Auth org-plugin **read-side** RBAC not verifiable statically without `node_modules`; single curl against a staging instance with a session cookie + `organizationId=<other-org>` resolves this in minutes. If leaky → cross-org member-email + invitation-list leak.
- **Live DAST** — recommend dynamic testing against staging after blockers close (was out-of-scope for static audit).

---

## 4. Full issue list by category

Counts below are *open* findings at SATURATED (iter 34). Listed §codes are the umbrella labels; each may have sub-bullets documented in `state/issues.md`.

### 4.1 Security (36)

#### Authentication & enumeration
§AUTH4 (oracle), §AUTH5 (signup enum), §AUTH6 (bounds), §AUTH7 (CRLF), §AUTH8 (name DoS), §AUTH9-iter7 (empty-name), §AUTH9-iter23 (envelope hint), §AUTH10 (signin lockout), §AUTH11 (oracle), §AUTH12 (**sig-format 500 + big-sig DoS — blocker B11**), §AU1 (**no password reset — blocker B21**), §R5 (**createChallenge unrate-limited — blocker B10**), §ENROLL1 (JWK validation).

#### Authorization & privilege
§OWN1 (**self-demote — blocker B4**), §OWN2 (**self-remove — blocker B4**), §INV1 (**owner-role invite — blocker B4**; also pending-invite GC), §ORG2 (**multi-org bootstrap — blocker B5**), §ORG2d (**code vs docs — blocker B5**), §I4 (**invite path wrong procedure — blocker B5**), §O3 (**multi-org CLI blocked — blocker B6**), §ORG1 (4-sub: no per-user cap, reserved slug, slug-taken oracle, logo URL scheme).

#### Information disclosure
§S1 (**stack+SQL+params leak — blocker B12**), §SEC4 (**500 dumps SQL — blocker B12**), §ENV2 (**envelope drift 4-sub — blocker B13**), §FLD2 (reveal no-field branch returns raw payload), §SEC11 (KDF/AES 5-sub — incl. HIGH sub §SEC11e AAD binding), §AGC1 (**agent-create hardening — blocker B20**).

#### DoS & resource abuse
§DoS1 (**challenge storage DoS — blocker B10**), §DoS2 (**no bodyLimit — blocker B8**), §RL1 (**429 envelope — blocker B7**), §RL1.b (no Retry-After), §RL2 (**XFF spoof — blocker B7**), §RL3 (**unknown bucket — blocker B7**), §RL4 (**per-isolate leak — blocker B7**), §RL5 (**cross-path contamination — blocker B7**), §CRYPTO-EDGE1 (**toBase64 overflow — blocker B9**).

#### Protection gaps
§CORS1 (3-sub), §HDR1 (3-sub: CSP, HSTS, Cache-Control), §P1 (**Effect.tryPromise rewraps — blocker B22**), §AG4 (duplicate pubkey), §RED1 (**MCP redaction bypass — blocker B19**), §AGR1 (non-idempotent revoke).

### 4.2 Correctness (18)

§I2 (**opaque-kind decoder — blocker B3**), §I5 (**RekeyedItemSchema keyNonce — blocker B2**), §I5-RACE (**rotate race — blocker B1**), §I6 (SM kind column dropped), §I8 (client-controlled mode branch), §I10 (items.ts:106-124 route pinpoint), §I11 (item-get method-type), §ON5 (**hardcoded ZK — blocker B16**), §ON5b (**missing KDF fields — blocker B16**), §ON6 (**no personal org — blocker B16**), §W2 (**unimplemented button stubs — blocker B17**), §W4 (**localStorage logout bleed — blocker B18**), §W19 (CLOSED iter 26), §W17 (**/terms+/privacy 404 — blocker B15**), §W22 (onboarding stale localStorage), §PROF1 (non-deterministic profile selection), §SDK9 (**drops issues — blocker B14**), §A1 (MCP cross-agent audit leak).

### 4.3 Reliability / scalability (9)

§DMN5 (6-sub FS hardening), §DMN6 (5-sub JSON-RPC), §DMN7 (unbounded buffer), §DMN8 (no idle/cap), §DMN9 (4-sub auto-lock), §M2 (mount persists + 3 sub), §RL3 / §RL4 (carried to P2), §SDK10 (disconnect race).

### 4.4 Performance (2)

§CRYPTO-EDGE1 (blocker B9), §DMN7 (carried as P4).

### 4.5 Observability (4)

§AUDIT5 (dead writer branch), §AUD1 (no cursor index), §AUD7 (dual audit shape), §A1 (cross-agent leak).

### 4.6 Developer experience (10)

§ORG6 (envelope not rendered), §CLI1 (3-sub help drift), §CLI-RUN-1 (env-var priority), §MCP10 (config shape), §MCP8 (legacy-auth drift), §DOC1, §DOC2 (11-sub), §DOC3 (9-sub, HIGH for doc fidelity), §TM1, §ENV1.

### 4.7 Testing (1 umbrella)

§TEST1 (3-sub: bun-test command, SDK orphan, zero regression for data-loss classes).

### 4.8 Infrastructure (3)

§W-STACK (**Next turbo — blocker B23**), §REL1 (2-sub changesets/version drift), §TSLASH1 (trailing-slash 301).

### 4.9 Schema / types drift (6)

§SCHEMA3 (amended iter 9), §SCHEMA4 (duplicated KDF schemas), §SDK4, §SDK7, §SDK8, §HTTP1 (method-type oracle).

### 4.10 DB (3)

§DB1 (dual audit schema), §DB2 (missing indexes), §AG4 (no unique pubkey).

### 4.11 Closed or retracted (4)

§W18 (merged into §W17 iter 27), §W19 (CLOSED iter 26 — fixed before sweep), §CLI6 (CLOSED — TTY guard confirmed), §CT1 (RETRACTED — port-drift false alarm iter 22).

### 4.12 Audit-sourced findings (security audit — 3 Critical + 12 High + 25 Medium unique)

Findings from the 4-wave security audit that are **not otherwise surfaced** by the E2E sweep. The audit uses a different taxonomy; below is a cross-reference so both artifacts are traceable. Items already listed in §4.1–§4.11 under a §code are marked "overlaps §code"; items marked "**NEW**" are net-additions.

#### 4.12.1 Critical (3)
- **W3P4-001 / C-1** — MCP `run_with_secret` long-secret plaintext leak to LLM — **NEW** (blocker B24). Distinct from §RED1 (which was about redactor bypass via encoding transforms); this is a buffer-ordering bug: the secret never fits in the 8 KB pre-redact buffer.
- **W3P12-001 / C-2** — daemon same-UID socket squat captures master password — **NEW** (blocker B25). Sweep surfaced socket handling at §DMN3/§DMN6 but never modeled a squatter.
- **COMPOSITE-001 / C-3** — cross-UID daemon RCE chain (W1S6-001 + W1S6-003 + W1S6-005) — **NEW** (blocker B26).

#### 4.12.2 High (12)
- **W1S6-001** — socket perms TOCTOU (chmod-after-listen race) — **NEW** (component of B26).
- **W1S6-003** — `exec.env` / `exec.expandEnv` / `exec.mount` RPCs require no auth, no unlock — **NEW** (component of B26).
- **W1S7-001** — XChaCha20-Poly1305 no AAD → cross-item substitution in a profile — **NEW** (blocker B28). Audit extends §SEC11e (AAD for server AES) to the ZK path.
- **W1S7-002** — AES-256-GCM no `additionalData` → **cross-org** substitution under single global `ENCRYPTION_KEY` — **NEW** (blocker B28). Extends §SEC11e to cross-org blast radius.
- **W1S8-001** — Better Auth org-plugin audit+cascade bypass (P0-2 incomplete; 8 hooks unwired) — **NEW** (blocker B33).
- **W1S8-002** — OAuth account pre-claim takeover — **NEW** (blocker B36).
- **W1S9-001** — `agents.revoke` / `agents.rotate` lack ownership check — **NEW** (blocker B35).
- **W2T2-001** — admin can mint `role="owner"` invite — **overlaps §INV1a** (already blocker B4). Audit provides additional verification detail.
- **W2T7-003** — `profiles.bootstrap` SELECT-then-UPDATE not atomic — **NEW** (blocker B29).
- **W2T12-001** — unrecognized bearer token no audit row — **NEW** (blocker B30).
- **W3P12-002** — W1S6-001 TOCTOU window deterministic with inotify/fsevents — **NEW** (component of B26).
- **W3P8-001** — Better Auth admin can promote member→admin via plugin endpoint, bypassing tRPC owner-only gate — **NEW** (blocker B34).

#### 4.12.3 Medium (25) — select audit-specific items not already covered by §codes

- **W1S1-001** — rate-limit per-isolate — **overlaps §RL4** (part of B7 umbrella).
- **W1S1-002** — `X-Forwarded-For` trust — **overlaps §RL2** (part of B7 umbrella).
- **W1S2-001** — web CSP/HSTS/frame-ancestors absent — **NEW** (v1.1 §3.11.5; elevated priority given threat-model reference).
- **W1S6-004** — unbounded daemon buffer — **overlaps §DMN7**.
- **W1S6-005** — no peer-credential check — **NEW** (component of B26).
- **W1S6-006** — mount file-mode bypass on existing file — **NEW** (v1.1 §3.11.1).
- **W1S6-010** — no unlock rate-limit — **NEW** (v1.1 §3.11.1).
- **W1S8-003** — password change no session revoke — **NEW** (v1.1 §3.11.2).
- **W1S8-004** — server password policy 8-char default vs 12-char UI — **NEW** (v1.1 §3.11.2).
- **W1S9-002** — `audit.listForAgent` leaks creator's entire trail — **NEW** (v1.1 §3.11.4).
- **W1S9-003** — last-owner stranding — **NEW** (blocker B37; extends B4 trio).
- **W2T6-004** — tRPC data.stack + DB error pass-through in prod — **NEW** (folded into B12 fix).
- **W2T7-001** — access revoke race (permission check + decrypt) — **NEW** (v1.1 §3.11.7).
- **W2T7-002** — agent revoke race (in-flight access) — **NEW** (v1.1 §3.11.7).
- **W2T7-007** — CLI `mount` existing-file mode bypass — **NEW** (v1.1 §3.11.7; shares helper with W1S6-006).
- **W2T9-001** — `auth.createChallenge` unauth + no GC — **overlaps §R5 + §DoS1** (part of B10 umbrella).
- **W2T9-002** — `auth.exchangeSession` unauth + audit spam — **overlaps §DoS1** (part of B10 umbrella).
- **W2T9-003** — scrypt pins Worker isolate — **NEW** (v1.1 §3.11.3).
- **W2T9-004** — item ciphertext/payload size unbounded — **overlaps §DoS2 + §CRYPTO-EDGE1** (part of B8+B9 umbrella); audit adds `Base64UrlBounded(1_048_576)` + `label: maxLength(255)` detail.
- **W2T11-005** — tRPC no `Cache-Control` on secret responses — **NEW** (v1.1 §3.11.5).
- **W2T12-002** — `safeAuditInsert` throw inverts caller safety — **NEW** (blocker B31).
- **W2T12-003** — denied-path audit gap (30+ sites) — **NEW** (blocker B32).
- **W3P5-001** — mount files survive `vault.lock` — **NEW** (v1.1 §3.11.1).
- **W3P10-001** — MCP `envVarName` bypasses reserved-keys blocklist — **NEW** (blocker B27, elevated given Critical pattern).
- **W3P12-003** — socket parent dir `mkdirSync` no explicit mode — **NEW** (folded into B26 fix).

#### 4.12.4 Low + Info (99) — not enumerated inline

The 55 Low + 44 Info audit findings are listed in `docs/security-audit/findings/{low,informational}/` under the `sleepy-pascal-324a1c` worktree. They do not gate production ship but accumulate in the `docs/security-audit/100-PRODUCTION-CHECKLIST.md` rows that remain `☐` after the blockers close. Plan to review + triage in v1.1 alongside this plan's P5 track.

---

## 5. Detailed remediation plan in execution order

Execution is organized into 6 production tracks. Each track is an independently mergeable PR with tests + rollout notes. Dependencies across tracks are explicit; tracks can otherwise be staffed in parallel (2 engineers can work P0+P2 simultaneously).

Each task block below includes: **files touched · test contract · validation command · commit message template · rollout risk**. Tracks P0–P3 are ship-blockers; P4/P5 are v1.1.

### Track P0 — Data integrity (ship-blocker)

**Goal:** close all 3 data-loss blockers. Estimated 3-4 engineer-days.

#### Task 1: §I5-RACE — serializable rotateKey + advisory lock + CAS on insert

**Files:**
- Modify: `packages/trpc/src/server/routers/profiles.ts:354-403`
- Modify: `packages/trpc/src/server/routers/items.ts:60-80` (ZK insert), `items.ts:106-124` (SM insert)
- Create: `packages/trpc/test/profiles-rotate-race.test.ts`
- Modify: `packages/db/src/client.ts` (export `withSerializableTxn` helper if not present)

- [ ] **Step 1:** Write the failing race test (8 parallel inserts mid-rotate, assert all either succeed+decrypt or fail with `CONFLICT`).
- [ ] **Step 2:** Run test; expect failure — current HEAD has no advisory lock.
- [ ] **Step 3:** Implement `withAdvisoryLock(profileId, fn)` helper using `pg_advisory_xact_lock(hashtext($1))`.
- [ ] **Step 4:** Wrap `rotateKey`'s read-and-rewrap block in serializable txn + advisory lock.
- [ ] **Step 5:** Wrap `items.create` (both branches) in advisory lock + `keyVersion` CAS for ZK insert.
- [ ] **Step 6:** Run test; expect pass.
- [ ] **Step 7:** Commit: `fix(trpc): serialize rotateKey + advisory lock + CAS on insert (§I5-RACE)`

**Rollout risk:** advisory locks are held per-txn; if a txn hangs, it blocks rotations for that profile. Acceptable — rotations are manual, rare, and should block on live inserts. Add a statement_timeout=30s safety net.

#### Task 2: §I5 — drop keyNonce from RekeyedItemSchema + column migration

**Files:**
- Modify: `packages/core/src/schemas/items.ts` (`RekeyedItemSchema` — drop `keyNonce`)
- Modify: `packages/trpc/src/server/routers/profiles.ts` (remove `keyNonce` from update set)
- Create: `packages/db/migrations/<timestamp>_drop_items_key_nonce.sql` (Drizzle migration)
- Modify: `packages/db/src/schema/items.ts` (drop `keyNonce` column)
- Create: `packages/trpc/test/rotate-item-roundtrip.test.ts`

- [ ] **Step 1:** Write round-trip test: 5 ZK items + rotate + decrypt all.
- [ ] **Step 2:** Run test against HEAD — expect failure on decrypt (schema bug).
- [ ] **Step 3:** Drop `keyNonce` from schema + add migration.
- [ ] **Step 4:** Apply migration to local DB: `bun run db:push`.
- [ ] **Step 5:** Run test — expect pass.
- [ ] **Step 6:** Commit: `fix(crypto): drop spurious keyNonce from RekeyedItemSchema (§I5)`

**Rollout risk:** migration drops a column. Backfill not needed (column was unused). Run in staging first; if prod has any rows where `keyNonce` is populated, investigate before migration.

#### Task 3: §I2 — use ItemPayloadSchema directly; remove `kind === 'opaque'` branch

**Files:**
- Modify: `packages/trpc/src/server/item-payload.ts:3-41`
- Create/update: `packages/trpc/test/item-payload.test.ts`

- [ ] **Step 1:** Enumerate `ITEM_KINDS` from `packages/core/src/constants.ts`; write one decode-round-trip test per kind.
- [ ] **Step 2:** Run tests — expect failures on all non-opaque kinds.
- [ ] **Step 3:** Replace body of `decodeServerManagedPayload` with `Schema.decodeUnknownSync(ItemPayloadSchema)(JSON.parse(new TextDecoder().decode(raw)))`.
- [ ] **Step 4:** Run tests — all pass.
- [ ] **Step 5:** Commit: `fix(trpc): decode all item kinds via ItemPayloadSchema (§I2)`

**Rollout risk:** none — pure fix. Existing opaque items still decode.

### Track P0.5 — Cryptographic AAD plumbing (ship-blocker — new from audit)

**Goal:** close W1S7-001 + W1S7-002 (cryptographic substitution attacks) and W2T7-003 (profile-bootstrap race). Estimated 4-5 engineer-days including migration soak. Can run in parallel with Track P0 but touches overlapping DB tables — coordinate with Track P0 Task 1 test fixtures.

#### Task A1: B28 / W1S7-001 + W1S7-002 — AEAD AAD helper + plumbing + migration

**Files:**
- Create: `packages/crypto/src/shared/aad.ts` (builder helpers)
- Modify: `packages/crypto/src/client/items.ts:21,29,52,59,81,86`
- Modify: `packages/crypto/src/client/keys.ts:25,44`
- Modify: `packages/crypto/src/server/encrypt.ts:36-40,60-64`
- Modify: `packages/trpc/src/server/routers/items.ts:109,236` (thread meta through encrypt)
- Modify: `packages/trpc/src/server/routers/access.ts:91-97` (thread meta through decrypt)
- Modify: `packages/core/src/constants.ts` — bump `CRYPTO_VERSION` 1 → 2
- Create: `packages/crypto/test/items-aad.test.ts`
- Create: `packages/crypto/test/server-aad.test.ts`
- Create: `packages/crypto/test/migration.test.ts`

- [ ] **Step 1:** Write all three test files first — both cross-item/cross-org substitution rejection tests + the migration rewrap-on-read test.
- [ ] **Step 2:** Run tests — expect failure (no AAD today).
- [ ] **Step 3:** Create `shared/aad.ts` with `buildContentAad`, `buildDekWrapAad`, `buildRootWrapAad`, `buildServerAad`.
- [ ] **Step 4:** Thread AAD into every encrypt/decrypt call site. Add the rewrap-on-read fallback: on v2-AAD decrypt failure, retry without AAD (= v1); if v1 succeeds, re-encrypt + write back in the same txn.
- [ ] **Step 5:** Bump `CRYPTO_VERSION` and add migration-progress metric (count of v1-remaining items).
- [ ] **Step 6:** Run all 3 test files — expect pass.
- [ ] **Step 7:** Staging soak: decrypt every existing row at least once (cron job or read-path organic); monitor v1-remaining to zero.
- [ ] **Step 8:** After 72h of zero v1-remaining on staging, remove the v1 fallback branch.
- [ ] **Step 9:** Commit: `fix(crypto): bind AEAD ciphertext to (orgId,profileId,itemId,keyVersion) via AAD (W1S7-001, W1S7-002)`

**Rollout risk:** largest in the plan. Existing ciphertext must remain decryptable during migration. Rewrap-on-read is idempotent but requires a write on read — adds ~1 extra UPDATE per read until v1 is drained. Customer-communication needed if operators prefer a forced re-encrypt (downtime, but faster cutover). Verify DB replica lag is not amplified.

#### Task A2: B29 / W2T7-003 — Atomic profile bootstrap

**Files:**
- Modify: `packages/trpc/src/server/routers/profiles.ts:210-250`
- Modify: `packages/core/src/errors.ts` (add `PROFILE_ALREADY_BOOTSTRAPPED`)
- Create: `packages/trpc/test/profiles-bootstrap-race.test.ts`

- [ ] **Step 1:** Write race test: two concurrent `profiles.bootstrap` with distinct `wrappedRootKey`.
- [ ] **Step 2:** Run against HEAD — expect failure (both succeed, losing data).
- [ ] **Step 3:** Replace SELECT-then-UPDATE with single atomic UPDATE `WHERE ... AND wrappedRootKey IS NULL RETURNING id`; on empty result throw `PROFILE_ALREADY_BOOTSTRAPPED`.
- [ ] **Step 4:** Run test — expect pass (exactly one 200 + one `PROFILE_ALREADY_BOOTSTRAPPED`).
- [ ] **Step 5:** Commit: `fix(trpc): atomic profiles.bootstrap with wrappedRootKey IS NULL guard (W2T7-003)`

**Rollout risk:** none. Pure bugfix; no migration.

### Track P1 — Authorization integrity (ship-blocker)

**Goal:** close 3 authorization blockers + multi-org bootstrap. Estimated 3-4 engineer-days.

#### Task 4: §OWN1+§OWN2+§INV1a — shared canAssignOrTransferOwnerRole predicate

**Files:**
- Create: `packages/trpc/src/server/auth/owner-guards.ts`
- Modify: `packages/trpc/src/server/routers/organizations.ts:856-893` (updateRole)
- Modify: `packages/trpc/src/server/routers/organizations.ts:798-854` (removeMember)
- Modify: `packages/trpc/src/server/routers/organizations.ts` (`invitations.create`)
- Modify: `packages/core/src/errors.ts` — add `INVARIANT_OWNER_REQUIRED` (HTTP 409)
- Create: `packages/trpc/test/owner-integrity.test.ts`

- [ ] **Step 1:** Write 6 test cases (3 deny + 3 allow).
- [ ] **Step 2:** Run — expect deny cases to pass (bug is "allow when should deny").
- [ ] **Step 3:** Create `owner-guards.ts` with `countOwners(ctx, orgId)` + `canAssignOrTransferOwnerRole({actingRole,targetRole,wouldLeaveZeroOwners})`.
- [ ] **Step 4:** Wire into all 3 routes before mutation; throw `InvariantOwnerError`.
- [ ] **Step 5:** Run tests — all pass.
- [ ] **Step 6:** Commit: `fix(trpc): guard owner-role assignment and removal (§OWN1,§OWN2,§INV1a)`

#### Task 5: §ORG2+§I4+§ORG2d — fix multi-org bootstrap middleware + invite procedures

**Files:**
- Modify: `packages/trpc/src/server/middleware/auth-optional-org.ts:45-52`
- Modify: `packages/trpc/src/server/routers/organizations.ts:936,941` (swap `sessionProcedure` → `userProcedure` for `getInviteInfo`/`acceptInvite`)
- Delete/update: stale docstring `init.ts:86-89`
- Create: `apps/api/test/multi-org-bootstrap.test.ts`, `packages/trpc/test/invite-accept-zero-memberships.test.ts`

- [ ] **Step 1:** Write tests: user-2-orgs hits `create`/`list`/`checkSlug` without header; user-0-memberships hits `getInviteInfo`/`acceptInvite`.
- [ ] **Step 2:** Run — all fail (header required + wrong procedure).
- [ ] **Step 3:** Add allowlist constant `OPTIONAL_ORG_HEADER_ROUTES = ['organizations.create', 'organizations.list', 'organizations.checkSlug', 'getInviteInfo', 'acceptInvite']`; middleware checks allowlist.
- [ ] **Step 4:** Change invite procedures.
- [ ] **Step 5:** Run tests — pass.
- [ ] **Step 6:** Commit: `fix(trpc): multi-org users can bootstrap; invitees can accept (§ORG2,§I4,§ORG2d)`

#### Task 6: §O3 — CLI + daemon thread X-Abadge-Org-Id

Already scoped in blocker B6. 6-file vertical slice. Follow file list above.

- [ ] **Step 1:** Write CLI integration test `apps/cli/test/multi-org-unlock.test.ts`.
- [ ] **Step 2:** Run — expect failure (400 on unlock).
- [ ] **Step 3:** Thread orgId through 6 files.
- [ ] **Step 4:** Run test — pass.
- [ ] **Step 5:** Commit: `fix(cli,daemon): thread activeOrgId through vault unlock (§O3)`

#### Task 6a: B34 / W3P8-001 — Override Better Auth `adminAc` to drop `member:["update"]`

**Files:**
- Modify: `packages/auth/src/server.ts:78-96` (add `ac` + `roles` to `organization()` plugin)
- Create: `packages/auth/src/plugin-rbac.ts` (define `adminAc`, `ownerAc`, `memberAc`)
- Create: `packages/auth/test/plugin-rbac.test.ts`

- [ ] **Step 1:** Write tests covering admin→admin promotion (deny), member→owner (deny, stays 403), owner→admin (200).
- [ ] **Step 2:** Run — first test fails today.
- [ ] **Step 3:** Add `createAccessControl(defaultStatements).newRole()` with explicit admin permissions (no `member:["update"]`).
- [ ] **Step 4:** Wire `ac` + `roles` into the plugin constructor.
- [ ] **Step 5:** Run — pass.
- [ ] **Step 6:** Commit: `fix(auth): override Better Auth adminAc to block admin→admin promotion (W3P8-001)`

#### Task 6b: B35 / W1S9-001 — `requireAgentOwnership` on agents.revoke + agents.rotate

**Files:**
- Modify: `packages/trpc/src/server/routers/agents.ts:199-262` (`rotateAgent`)
- Modify: `packages/trpc/src/server/routers/agents.ts:264-326` (`revokeAgent`)
- Create: `packages/trpc/test/agents-ownership.test.ts`

- [ ] **Step 1:** Write tests: member bob rotates/revokes alice's agent → 403 `MEMBER_AGENT_OWNERSHIP`; owner/admin allowed.
- [ ] **Step 2:** Run — both 200 against HEAD.
- [ ] **Step 3:** Insert `yield* tryAsync(() => requireAgentOwnership(ctx.db, agentId, ctx.identity.userId, ctx.identity.organizationId, callerRole))` after existing org-scope lookup in both routes.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(trpc): require agent ownership on rotate/revoke (W1S9-001)`

#### Task 6c: B36 / W1S8-002 — OAuth pre-claim takeover mitigation

**Files:**
- Modify: `packages/auth/src/server.ts:43-50` (`emailAndPassword`, `emailVerification`, `account.accountLinking`)
- Modify: `packages/env/src/server.ts` (add `EMAIL_PROVIDER_API_KEY`)
- Modify: `apps/web/src/app/(auth)/register/page.tsx` (surface verification requirement)
- Create: `apps/web/src/app/verify-email/page.tsx`
- Create: `packages/auth/test/oauth-preclaim.test.ts`

- [ ] **Step 1:** Choose email provider (shares decision with B21 Task 20).
- [ ] **Step 2:** Write pre-claim test: pre-register unverified `victim@example.com`, simulate Google OAuth sign-in with `email_verified:true`; assert no implicit link.
- [ ] **Step 3:** Run — fails (implicit link happens today).
- [ ] **Step 4:** Set `emailAndPassword.requireEmailVerification: true`, add `account: { accountLinking: { enabled: true, disableImplicitLinking: true, trustedProviders: [] } }`, wire `sendVerificationEmail`.
- [ ] **Step 5:** Add Better Auth `before` hook that aborts link when existing user has `emailVerified: false`.
- [ ] **Step 6:** Run — pass.
- [ ] **Step 7:** Commit: `fix(auth): require email verification + disable implicit OAuth linking (W1S8-002)`

**Rollout risk:** breaking for existing unverified users. Migration plan: force-verify all pre-existing users via a one-time admin tool, OR grandfather them with a `pre_fix: true` flag. Communicate explicitly.

#### Task 6d: B37 / W1S9-003 — Last-owner stranding check

Folded into Task 4 (B4 shared `canAssignOrTransferOwnerRole` predicate). The B4 helper gets two extra branches:
- `removeMember`: reject when `targetRole==='owner' && countOwners(org) === 1`.
- `updateMemberRole`: reject when `actor.id === target.id && actor.role==='owner' && countOwners(org) === 1 && newRole !== 'owner'`.

Regression tests append to `owner-integrity.test.ts` (B4 test file).

### Track P1.5 — Local trust: MCP + daemon (ship-blocker — new from audit)

**Goal:** close all 3 Criticals (C-1, C-2, C-3) from the audit. Estimated 4-6 engineer-days including pen-test re-run. No overlap with Tracks P0/P0.5; staff in parallel if 3rd engineer available.

#### Task B1: B24 / W3P4-001 — MCP long-secret guard

**Files:**
- Modify: `packages/mcp/src/resolve-secret.ts` (add `Buffer.byteLength` assertion)
- Modify: `packages/mcp/src/tools/run-with-secret.ts:24-35, 145-148` (emit clearer error when guard fails)
- Modify: `docs/MCP.md:117-126` (document long-secret constraint)
- Create: `packages/mcp/test/run-with-secret-long-secret.test.ts`

- [ ] **Step 1:** Write test: secret of 9000 bytes echoed by subprocess — response must be `SECRET_TOO_LARGE_FOR_RUN_WITH_SECRET` error OR `stdoutLines=["[REDACTED]"]`; **never** a prefix of the plaintext.
- [ ] **Step 2:** Run against HEAD — test fails; 4096 bytes of plaintext PEM appear in response.
- [ ] **Step 3:** In `resolveSecret`, after decryption, assert `Buffer.byteLength(secretValue, "utf8") <= MAX_OUTPUT_BYTES`; otherwise throw domain error before `spawn` is called.
- [ ] **Step 4:** Update MCP.md section on redaction limitations.
- [ ] **Step 5:** Run test — pass.
- [ ] **Step 6:** Commit: `fix(mcp): refuse run_with_secret for secrets larger than redaction window (W3P4-001)`

**Rollout risk:** breaking for any operator currently using `run_with_secret` with multi-KB secrets. Release notes explicit; long secrets must use `mount_secret` (filesystem) instead. Version-bump `@abadge/mcp` minor.

#### Task B2: B27 / W3P10-001 — MCP `envVarName` validation

**Files:**
- Modify: `packages/daemon/src/server.ts:45-90` — export `RESERVED_ENV_KEYS` (or move to `packages/core/src/constants.ts`)
- Modify: `packages/mcp/src/tools/run-with-secret.ts:12-22, 135-142` (add validation)
- Create: `packages/mcp/test/env-var-name.test.ts`

- [ ] **Step 1:** Write test table — each key in `RESERVED_ENV_KEYS` as `envVarName` → rejection; normal keys → accepted.
- [ ] **Step 2:** Run — failures; every reserved key passes through today.
- [ ] **Step 3:** Move `RESERVED_ENV_KEYS` to shared location; import and check in MCP handler.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(mcp): validate envVarName against daemon reserved-keys list (W3P10-001)`

#### Task B3: B25 / W3P12-001 — Daemon TOFU keypair pin + challenge handshake

**Files:**
- Create: `packages/daemon/src/identity.ts` (keypair gen + signer)
- Modify: `packages/daemon/src/server.ts` (generate keypair on first start; handle challenge RPC)
- Modify: `packages/daemon/src/client.ts:36-69` (verify before sending sensitive params)
- Modify: `packages/cli/src/commands/daemon.ts:69-108` (pin fingerprint in config)
- Modify: `~/.abadge/config.json` schema (add `daemonFingerprint`)
- Create: `packages/daemon/test/identity-handshake.test.ts`

- [ ] **Step 1:** Write 3 tests: (a) fresh daemon → CLI pins fingerprint + proceeds; (b) daemon restart with same keypair → normal flow; (c) daemon restart with new keypair → CLI aborts with `DAEMON_IDENTITY_MISMATCH`.
- [ ] **Step 2:** Run — all fail (no handshake today).
- [ ] **Step 3:** On daemon start: generate Ed25519 keypair; write public key atomically to `~/.abadge/daemon.pub` (0644); keep private in-memory.
- [ ] **Step 4:** On CLI `DaemonClient.send`: before any sensitive RPC, send a 32-byte nonce; daemon signs `nonce || bindTimestamp`; CLI verifies against pinned fingerprint.
- [ ] **Step 5:** Belt-and-suspenders: add pre-connect `lstatSync` check — abort if `(mode & 0o777) !== 0o600` or `uid !== getuid()`.
- [ ] **Step 6:** Run tests — pass.
- [ ] **Step 7:** Commit: `feat(daemon,cli): TOFU keypair pin + challenge handshake for socket identity (W3P12-001)`

**Rollout risk:** existing users get a one-time "new daemon identity" prompt on first run after upgrade — document this in release notes as expected. New installs silently bootstrap.

#### Task B4: B26 / COMPOSITE-001 — Daemon atomic socket perms + exec auth + peer-cred

**Files:**
- Modify: `packages/daemon/src/server.ts:517` (parent mkdir mode)
- Modify: `packages/daemon/src/server.ts:529-566` (umask guard around Bun.listen)
- Modify: `packages/daemon/src/server.ts:342-436` (auth + unlock gates on exec.*)
- Modify: `packages/daemon/src/server.ts:529-557` (peer-cred check on accept)
- Create: `packages/daemon/test/socket-perms.test.ts`
- Create: `packages/daemon/test/exec-auth-gate.test.ts`
- Create: `packages/daemon/test/peer-cred.test.ts`

- [ ] **Step 1:** Write all 3 tests first.
- [ ] **Step 2:** Run — all fail.
- [ ] **Step 3 (atomic socket):** wrap `Bun.listen` with `process.umask(0o077)` try/finally; post-listen `statSync` invariant abort.
- [ ] **Step 4 (parent dir):** `mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })` + post-stat invariant.
- [ ] **Step 5 (exec gates):** top of `exec.env` / `exec.expandEnv` / `exec.mount`: `buildAuthHeaders(auth); requireUnlocked(vault);`. Introduce per-RPC ACL tag.
- [ ] **Step 6 (peer-cred):** accept handler reads SO_PEERCRED (Linux) / getpeereid (macOS); reject non-matching UID before any frame read. If Bun FFI doesn't expose it, switch to `node:net` `createServer`.
- [ ] **Step 7:** Run all 3 tests — pass.
- [ ] **Step 8:** Strip `ABADGE_*` keys from child `process.env` before `Bun.spawn` (prevents leaking our own env to subprocess).
- [ ] **Step 9:** Commit: `fix(daemon): atomic socket perms + exec auth + peer-cred on accept (W1S6-001,003,005,W3P12-002,003)`

**Rollout risk:** peer-cred switch may require Node `net` migration if Bun doesn't expose the socket fd. Verify on both macOS and Linux. Existing Docker configurations that share UIDs across containers need review.

### Track P2 — DoS, rate-limit, and abuse (ship-blocker)

**Goal:** close all rate-limit, body-size, challenge-storage, and sig-oracle blockers. Estimated 3-5 engineer-days (Durable Object work).

#### Task 7: §RL1-5 — rate-limit middleware rewrite with Durable Object

**Files:**
- Rewrite: `apps/api/src/middleware/rate-limit.ts`
- Create: `apps/api/src/durable-objects/rate-limit-counter.ts`
- Modify: `apps/api/wrangler.jsonc` (DO binding)
- Modify: `packages/core/src/errors.ts` (TOO_MANY_REQUESTS envelope with retryAfter)
- Modify: `AGENTS.md` (document DO exception + rationale)
- Create: `apps/api/test/rate-limit.test.ts`

- [ ] **Step 1:** Write the 6 tests in B7's verify plan.
- [ ] **Step 2:** Run — all fail.
- [ ] **Step 3:** Implement DO with simple SQLite-backed counter + TTL.
- [ ] **Step 4:** Rewrite middleware: path:ip key; trust-proxy gate; envelope + Retry-After.
- [ ] **Step 5:** Run tests — all pass.
- [ ] **Step 6:** Commit: `fix(api): rewrite rate-limit middleware with DO + path:ip keying (§RL1,2,3,4,5)`

**Rollout risk:** first DO in repo. Review wrangler binding + deploy to staging; verify DO actually throttles under real load. Consider shadowing the old middleware for 24h before switchover.

#### Task 8: §DoS2 + §CRYPTO-EDGE1 — body limit + chunked base64 + payload ceiling

**Files:**
- Modify: `apps/api/src/app.ts` (add `bodyLimit(1MB)` + `PAYLOAD_TOO_LARGE` envelope)
- Modify: `packages/core/src/schemas/items.ts` (`MAX_PLAINTEXT_BYTES = 256*1024` on payload)
- Modify: `packages/crypto/src/base64.ts` (chunked `toBase64`)
- Create: `apps/api/test/body-limit.test.ts`, `packages/crypto/test/base64-large.test.ts`

- [ ] **Step 1:** Write tests: 2 MB body → 413; 2 MB buffer → base64 round-trip without overflow.
- [ ] **Step 2:** Run — both fail.
- [ ] **Step 3:** Add Hono bodyLimit; update schema; chunk base64.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(api,crypto): add body limit + chunked base64 + payload ceiling (§DoS2,§CRYPTO-EDGE1)`

#### Task 9: §R5+§DoS1 — challenge GC + rate-limit + oracle collapse

**Files:**
- Modify: `packages/trpc/src/server/routers/auth.ts:462-513`
- Modify: rate-limit middleware (ensure `auth.*` tRPC routes get 60/min after Task 7)
- Modify: DB cleanup logic in `challenge` handler (opportunistic `DELETE WHERE expiresAt < now()`)
- Create: `apps/api/test/challenge-rate-and-gc.test.ts`

- [ ] **Step 1:** Write tests per B10.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Opportunistic GC + rate-limit binding + oracle collapse (unify 200 response).
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(auth): rate-limit + GC + collapse oracle on createChallenge (§R5,§DoS1,§AUTH4)`

#### Task 10: §P1 helper + §AUTH12 fix

**Files:**
- Create: `packages/trpc/src/server/effect/try-preserving.ts`
- Codemod: 45+ call-sites of `Effect.tryPromise({try, catch})` in `packages/trpc/src/server/routers/*.ts`
- Modify: `packages/core/src/schemas/auth.ts` (SignatureSchema MaxLength)
- Create: `packages/trpc/test/try-preserving.test.ts`, `apps/api/test/exchange-session-oracle.test.ts`

- [ ] **Step 1:** Write helper unit test + §AUTH12 integration test.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Add helper; run codemod; add SignatureSchema ceiling.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `refactor(trpc): preserve domain errors through Effect.tryPromise (§P1,§AUTH12)`

### Track P3 — Privacy, envelope, compliance (ship-blocker)

#### Task 11: §S1+§SEC4 — error-formatter production-mode gate

**Files:**
- Modify: `packages/trpc/src/server/init.ts:55`
- Modify: env detection to gate `isDev`
- Create: `packages/trpc/test/error-formatter.test.ts`

- [ ] **Step 1:** Write two tests (prod strips; dev exposes).
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Add production gate; sealed allowlist helper.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(trpc): strip stack+SQL+params in production error formatter (§S1,§SEC4)`

#### Task 12: §ENV2 umbrella — envelope uniformity across Hono + /api/auth + 429 + 404

**Files:**
- Modify: `packages/trpc/src/server/errors.ts` (revive `parseErrorToValidationError` path; teach formatter to detect `Effect.ParseError`)
- Create: `apps/api/src/middleware/auth-envelope.ts` (wrap `/api/auth/*` 4xx into envelope)
- Modify: `apps/api/src/app.ts` (`app.notFound()` + `app.onError()`)
- Modify: `packages/core/src/errors.ts` (`ORG_MEMBERSHIP_REQUIRED` 401→403)
- Create: `apps/api/test/error-envelopes.test.ts`

- [ ] **Step 1:** Write cross-path envelope tests.
- [ ] **Step 2:** Run — fail on 3+ paths.
- [ ] **Step 3:** Wire 4 fixes.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(api): unify error envelope across Hono/tRPC/auth/429/404 (§ENV2)`

#### Task 13: §SDK9 — AbadgeApiError.issues round-trip

**Files:**
- Modify: `packages/sdk/src/errors.ts` (+`issues?: Issue[]`)
- Modify: `packages/sdk/src/client.ts` (parse from response)
- Create: `packages/sdk/test/api-error.test.ts`

- [ ] **Step 1:** Write test.
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** ≤5-LoC add.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(sdk): preserve issues field in AbadgeApiError (§SDK9)`

#### Task 14: §W17 — /terms + /privacy real pages or consent removal

**Files:**
- Create: `apps/web/src/app/terms/page.tsx` + `apps/web/src/app/privacy/page.tsx` (with real content from legal)
- OR remove consent language from `apps/web/src/app/register/page.tsx`
- Create: `apps/web/test/e2e/terms-privacy.spec.ts`

- [ ] **Step 1:** Decide: pages or consent removal. (Requires legal input.)
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run Playwright test.
- [ ] **Step 4:** Commit: `fix(web): add real terms+privacy pages (§W17)` OR `fix(web): drop consent link to nonexistent pages (§W17)`

#### Task 15: §ON5+§ON5b+§ON6 — new-user flow hooks + non-hardcoded storageMode

**Files:**
- Modify: `packages/auth/src/server.ts` (add `afterSignUp`/`afterSignIn` org+profile seeder)
- Modify: `packages/trpc/src/server/routers/organizations.ts:281-288` (read storageMode from request)
- Modify: `packages/trpc/src/server/routers/profiles/resolve-profile.ts:51-70` (storage-mode check on adopt)
- Modify: `packages/core/src/schemas/organizations.ts` (`CreateOrganizationSchema` — require KDF fields iff ZK)
- Create: `apps/api/test/onboarding.test.ts`

- [ ] **Step 1:** Write tests per B16.
- [ ] **Step 2:** Run — fail (no org seeded; ZK hardcoded).
- [ ] **Step 3:** Wire hook + storage-mode switch + schema refinement.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(auth,trpc): seed personal org on signup + honor storageMode (§ON5,§ON5b,§ON6)`

#### Task 16: §W2 — implement profile-detail action handlers

**Files:**
- Modify: `apps/web/src/components/profiles/key-action-row.tsx` (+ `onClick` prop)
- Modify: `apps/web/src/app/profiles/[id]/page.tsx` (wire `trpc.profiles.changePassword/rotateKey/delete.useMutation()`)
- Create: `apps/web/test/e2e/profile-detail-actions.spec.ts`

- [ ] **Step 1:** Write Playwright test covering all 5 buttons.
- [ ] **Step 2:** Implement handlers.
- [ ] **Step 3:** Run — pass.
- [ ] **Step 4:** Commit: `feat(web): implement profile detail action handlers (§W2)`

#### Task 17: §W4 — clear Zustand + queryClient on signOut

**Files:**
- Modify: `apps/web/src/components/nav-user.tsx:43-47` (one-line fix)
- Create: `apps/web/test/e2e/logout-clears-org.spec.ts`

- [ ] **Step 1:** Playwright test: user-A logs out → user-B login has no x-abadge-org-id.
- [ ] **Step 2:** Add `clearActiveOrg() + queryClient.clear()` before `signOut()`.
- [ ] **Step 3:** Run — pass.
- [ ] **Step 4:** Commit: `fix(web): clear active org + query cache on sign out (§W4)`

#### Task 18: §RED1 — drop MCP subprocess output to LLM

**Files:**
- Modify: `packages/mcp/src/tools/run-with-secret.ts`
- Modify: `docs/MCP.md` (document capability change)
- Create: `packages/mcp/test/run-with-secret.test.ts`

- [ ] **Step 1:** Write test asserting secret is never echoed.
- [ ] **Step 2:** Run — fail (secret reachable via 14+ vectors).
- [ ] **Step 3:** Return only `{exitCode,durationMs,outputLineCount}`.
- [ ] **Step 4:** Update docs.
- [ ] **Step 5:** Commit: `fix(mcp): drop subprocess output pipe to LLM (§RED1)` — **BREAKING MCP CHANGE**

**Rollout risk:** breaking change for MCP consumers that depend on subprocess output. Version-bump `@abadge/mcp` to 1.0 (or 0.x bump). Release notes explicit.

#### Task 19: §AGC1 — agents.create + auth.enrollAgent hardening

**Files:**
- Modify: `packages/core/src/schemas/agents.ts`
- Modify: `packages/trpc/src/server/routers/agents.ts`
- Modify: `packages/trpc/src/server/routers/auth.ts` (enrollAgent mirror)
- Create: `apps/api/test/agents-create-hardening.test.ts`

- [ ] **Step 1:** Write 6 tests (quota, meta-size, meta-depth, combo, name, mirror).
- [ ] **Step 2:** Run — fail.
- [ ] **Step 3:** Apply 5 fixes.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(trpc,core): harden agents.create + enrollAgent (§AGC1)`

#### Task 20: §AU1 — wire password reset flow

**Files:**
- Modify: `packages/auth/src/server.ts` (enable reset plugin + wire `sendResetPassword`)
- Modify: `packages/env/src/server.ts` (add `EMAIL_PROVIDER_API_KEY`)
- Create: `apps/web/src/app/forgot-password/page.tsx`, `apps/web/src/app/reset-password/[token]/page.tsx`
- Create: `apps/web/test/e2e/password-reset.spec.ts`

- [ ] **Step 1:** Choose email provider. (Decision input required.)
- [ ] **Step 2:** Write Playwright E2E.
- [ ] **Step 3:** Run — fail.
- [ ] **Step 4:** Wire sender + UI pages.
- [ ] **Step 5:** Run — pass.
- [ ] **Step 6:** Commit: `feat(auth,web): password reset via email (§AU1)`

#### Task 21: §W-STACK — permanent workaround committed

**Files:**
- Verify committed: `apps/web/src/app/global-error.tsx` (stub)
- Modify: `apps/web/package.json` (add `"predev": "rm -rf .next"`)
- File upstream issue: vercel/next.js with minimal repro
- Update: `docs/DEVELOPMENT.md` (note the workaround)

- [ ] **Step 1:** Commit stub + predev script.
- [ ] **Step 2:** Verify `bun run dev` at apps/web green.
- [ ] **Step 3:** File issue upstream.
- [ ] **Step 4:** Commit: `chore(web): permanent Next 15.5.14 turbo RSC manifest workaround (§W-STACK)`

### Track P3.5 — Audit-coverage restoration (ship-blocker — new from audit)

**Goal:** close the "~80% of failed-action paths have no audit" gap. Three audit-sourced blockers + one Better Auth hook pass, all sharing infrastructure (`tryAuthorizeOrAudit` helper + `safeAuditInsert` hardening). Estimated 3-4 engineer-days.

#### Task C1: B31 / W2T12-002 — Make `safeAuditInsert` caller-safe (must land first)

**Files:**
- Modify: `packages/trpc/src/server/audit.ts:46-76` (`log*Audit` helpers)
- Modify: `packages/trpc/src/server/effect.ts:105-110, 72-92` (if `tryAsync` is reused)
- Create: `packages/trpc/test/audit-write-failure.test.ts`

- [ ] **Step 1:** Write test: mock audit insert to throw; assert primary mutation still returns success; assert warning logged.
- [ ] **Step 2:** Run — test fails (client sees 500 today).
- [ ] **Step 3:** Wrap `log*Audit`'s `tryAsync` with `.pipe(Effect.catchAll((err) => { console.warn("audit_write_failed", {err, context}); return Effect.void; }))`. Add a lightweight dead-letter metric/counter.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(trpc): audit write failures never invert caller success (W2T12-002)`

#### Task C2: B30 / W2T12-001 — Audit unrecognized bearer tokens

**Files:**
- Modify: `packages/trpc/src/server/auth.ts:397-413` (final `UNAUTHORIZED` path)
- Modify: `packages/trpc/src/server/auth.ts:194-196, 122-169` (session-not-found + legacy-key misses)
- Modify: `packages/db/src/schema/audit.ts` (allow null `organizationId`/`userId` OR use `__unauth__` placeholder)
- Modify: `packages/core/src/constants.ts` — add `"agent.session_reject"` with reason taxonomy
- Create: `packages/trpc/test/audit-bearer-miss.test.ts`

- [ ] **Step 1:** Write test: 10 random bearer tokens → at least one `agent.session_reject` row with `meta.reason="unknown_credential"` and `meta.tokenPrefix` only (never the full token).
- [ ] **Step 2:** Run — zero audit rows written today.
- [ ] **Step 3:** Extend `auditAgentSessionReject` (existing helper at `auth.ts:96-119`) to accept a new reason `"unknown_credential"`. Call it from the final fail branches with `meta.tokenPrefix: token.slice(0, 4)` (NEVER log full token).
- [ ] **Step 4:** Cap audit writes to 1/IP/10s with `floodSuppressed: true` meta on bursts — prevent attacker-driven audit-log DoS.
- [ ] **Step 5:** Run — pass.
- [ ] **Step 6:** Commit: `fix(trpc): audit unrecognized bearer tokens (W2T12-001)`

**Rollout risk:** audit_logs row volume will increase on credential-stuffing attacks. Ensure audit-log retention / partitioning policy is in place (W2T12-005 Info).

#### Task C3: B32 / W2T12-003 — `tryAuthorizeOrAudit` helper + 30-site codemod

**Files:**
- Create: `packages/trpc/src/server/init.ts` — export `tryAuthorizeOrAudit(check, auditMeta, onSuccess)`
- Codemod: 30+ call sites across `permissions.ts`, `agents.ts`, `items.ts`, `organizations.ts`, `auth.ts`
- Create: `packages/trpc/test/audit-denied-coverage.test.ts`

- [ ] **Step 1:** Write test: one case per category (org role fail, item not found, permission check fail, agent ownership fail); each asserts exactly one `denied` audit row with correct `eventType`.
- [ ] **Step 2:** Run — zero denied audit rows today.
- [ ] **Step 3:** Implement helper mirroring the pattern at `routers/access.ts:212-220`.
- [ ] **Step 4:** Apply to the 30+ sites listed in blocker B32's "Finding sites" list.
- [ ] **Step 5:** Run — all test categories pass.
- [ ] **Step 6:** Commit: `fix(trpc): audit denied-path branches via tryAuthorizeOrAudit helper (W2T12-003)`

#### Task C4: B33 / W1S8-001 — Wire 8 Better Auth org-plugin hooks

**Files:**
- Modify: `packages/auth/src/server.ts:79-95`
- Create: `packages/auth/src/audit-hooks.ts` (row-builder helpers)
- Create: `packages/auth/test/plugin-hooks-coverage.test.ts`

- [ ] **Step 1:** Write test: for each of 8 endpoints (`update`, `update-member-role`, `remove-member`, `invite-member`, `accept-invitation`, `reject-invitation`, `cancel-invitation`, plus any the audit finding identified), POST via Better Auth handler; assert one audit row with correct `eventType` + for destructive events assert `onMemberRemoved` cascade ran.
- [ ] **Step 2:** Run — tests fail (only 2 hooks wired).
- [ ] **Step 3:** Add missing hooks; each calls `safeAuditInsert` inside a `db.transaction`; for destructive events, invoke existing `onMemberRemoved` cascade.
- [ ] **Step 4:** Run — pass.
- [ ] **Step 5:** Commit: `fix(auth): wire all Better Auth org-plugin lifecycle hooks to audit + cascade (W1S8-001)`

**Alternative:** if hook wiring proves brittle, `disableRoutes` the affected plugin endpoints and require all mutations via tRPC (which is already correctly wired). Document decision in the PR.

### Track P4 — Reliability + observability (v1.1, 30 days)

All items listed in §3.1–3.5, §3.8, and **§3.11 (audit-sourced non-blocking items)** above, each implemented as a separate PR with:
- **Files** — per-finding file:line (see `state/issues.md` from the sweep OR `docs/security-audit/findings/{medium,low}/*.md` from the audit).
- **Test contract** — regression test + existing-behavior preservation test.
- **Commit** — one §code OR one W-ID per commit; umbrella code = one PR with commits-per-sub.

Track P4 can be staffed independently of Tracks P0–P3.5 after those blockers close. No cross-dependency on P0–P3.5 except:
- §DMN9 / W3P5-001 mount-persists interacts with daemon auto-lock behavior tested in P3 Task 21.
- Audit-sourced W2T7-001/002 access races must land AFTER P0.5 Task A1 AAD plumbing (they touch the same access.reveal path).
- CLI mount-mode bypass (W2T7-007) shares a helper with daemon W1S6-006 fix in P1.5 Task B4; land P1.5 first.

### Track P5 — Docs, tests, release pipeline (v1.1, parallel with P4)

- **Docs-only PR** (§DOC1+§DOC2+§DOC3+§TM1+§ENV1+§MCP8+§AGENTS.md corrections) — zero code risk, shippable anytime. **Can ship in parallel with Tracks P0–P3**; does not block anything.
- **§TEST1**: AGENTS.md command fix; add `@abadge/sdk` to turbo test pipeline; regression tests for data-loss classes (already embedded in Track P0 tasks).
- **§REL1**: converge SDK onto changesets; audit private-pkg version drift.

### Ordering summary (revised to include audit tracks)

```
Week 1:  Track P0 (Tasks 1-3)      ◀ data integrity ship-blocker
Week 1:  Track P0.5 (Tasks A1, A2) ◀ crypto AAD + profile-bootstrap (parallel with P0, new from audit)
Week 1:  Track P5 docs-only PR     ◀ parallel, zero risk
Week 2:  Track P1 (Tasks 4-6)      ◀ authz ship-blocker; depends on P0 only for test infra
Week 2:  Track P2 (Tasks 7-10)     ◀ rate-limit + DoS ship-blocker
Week 3:  Track P3 (Tasks 11-21)    ◀ envelope + compliance + web; depends on P0-P2
Week 4:  Launch checkpoint: Production Readiness Review (§6 checklist)
Week 5+: Track P4 (v1.1)
Week 5+: Track P5 tests + release (v1.1)
```

Parallelism: with 2 engineers, Week 2–3 can overlap (P1 + P2 parallel). Week 3 P3 tasks 11–14 (envelope + SDK) parallel with 15–18 (web). Password reset (Task 20) is gated on email provider decision.

### Regression risks by fix

- **Task 1 (§I5-RACE):** advisory locks could cause contention on hot profiles. Mitigate: statement_timeout=30s.
- **Task 2 (§I5):** column drop requires staging verification. If any rows have `keyNonce` populated, data-migrate before drop.
- **Task 7 (§RL1-5):** first Durable Object. Shadow-deploy, verify counter behavior in staging for 24h before flipping over.
- **Task 11 (§S1+§SEC4):** dev-mode users lose stack traces — confirm internal tooling (Sentry etc.) has stacks via error reports, not response bodies.
- **Task 12 (§ENV2):** any SDK consumer parsing the old shape will break. Version-bump SDK + release notes.
- **Task 18 (§RED1):** breaking MCP change. Major SDK version bump.
- **Task 20 (§AU1):** email provider is new dependency; failure mode → reset links don't send. Fallback: rate-limit reset requests to prevent abuse.

---

## 6. Final production readiness checklist

All items are pass/fail. Sign off before production.

### 6.1 Data integrity

- [ ] §I5-RACE: `profiles-rotate-race.test.ts` green against staging Postgres.
- [ ] §I5: `rotate-item-roundtrip.test.ts` green; migration applied in staging without data loss.
- [ ] §I2: `item-payload.test.ts` covers every `ITEM_KINDS` constant with round-trip.
- [ ] W2T7-003: `profiles-bootstrap-race.test.ts` green; exactly one 200 + one `PROFILE_ALREADY_BOOTSTRAPPED` on concurrent bootstrap.

### 6.1.5 Cryptographic AAD binding (audit-sourced)

- [ ] W1S7-001: `items-aad.test.ts` green — cross-item substitution (P, itemA ↔ P, itemB) fails Poly1305 auth.
- [ ] W1S7-001: `items-aad.test.ts` green — contentVersion rollback (v5 → v4) fails Poly1305 auth.
- [ ] W1S7-002: `server-aad.test.ts` green — cross-org substitution (orgA/profA/itemA ↔ orgA/profA/itemB) fails AES-GCM `OperationError`.
- [ ] `migration.test.ts` green — v1 ciphertext pre-seed → read → rewrap to v2 → second read returns v2 only.
- [ ] CRYPTO_VERSION bumped 1 → 2 in `packages/core/src/constants.ts`.
- [ ] Staging: v1-remaining counter at zero for ≥72h before v1 fallback branch is removed.
- [ ] Customer communication plan documented and sent if forced re-encrypt was chosen instead of rewrap-on-read.

### 6.2 Authorization

- [ ] §OWN1/§OWN2/§INV1a: `owner-integrity.test.ts` — 3 deny + 3 allow cases all green.
- [ ] §ORG2/§I4/§ORG2d: `multi-org-bootstrap.test.ts` + `invite-accept-zero-memberships.test.ts` green.
- [ ] §O3: `multi-org-unlock.test.ts` green; audit trail records correct orgId per unlock.
- [ ] W3P8-001: `plugin-rbac.test.ts` — admin cannot promote member→admin via Better Auth `/update-member-role` (403).
- [ ] W1S9-001: `agents-ownership.test.ts` — member rotating/revoking another member's agent returns 403.
- [ ] W1S8-002: `oauth-preclaim.test.ts` — OAuth sign-in does not silently link to unverified credential user.
- [ ] W1S9-003: last-owner check folded into `owner-integrity.test.ts` — sole owner self-remove + admin-evicts-sole-owner both denied.

### 6.3 DoS + rate limit

- [ ] §RL1-5: Durable Object backing counters is deployed in staging; `rate-limit.test.ts` 6/6 green; manual XFF spoof test confirms bucket is per-client-IP, not per-spoofed-header.
- [ ] §DoS2: `body-limit.test.ts` green; Hono bodyLimit is at app root, not per-route.
- [ ] §CRYPTO-EDGE1: `base64-large.test.ts` green; `items-schema.test.ts` enforces `MAX_PLAINTEXT_BYTES`.
- [ ] §R5+§DoS1: `challenge-rate-and-gc.test.ts` green; challenge oracle collapsed to single 200 shape.
- [ ] §AUTH12: `exchange-session-oracle.test.ts` green; no 500 on malformed sig.
- [ ] §P1: `try-preserving.test.ts` green; codemod applied; CI verified zero remaining `Effect.tryPromise({try,catch})` usages.

### 6.4 Privacy + envelope

- [ ] §S1+§SEC4: `error-formatter.test.ts` passes in prod env mode; no stack/SQL/params on any 4xx/5xx.
- [ ] §ENV2: `error-envelopes.test.ts` passes across Hono 404, tRPC 404, /api/auth/* 4xx, 429, 403.
- [ ] §SDK9: `api-error.test.ts` confirms `issues` round-trip.

### 6.5 Compliance

- [ ] §W17: `/terms` + `/privacy` return 200 OR consent link removed.
- [ ] §AU1: `password-reset.spec.ts` green; email delivery confirmed via provider dashboard.

### 6.6 User flows

- [ ] §ON5/§ON5b/§ON6: `onboarding.test.ts` — fresh signup → 1 org + 1 profile with correct storageMode.
- [ ] §W2: `profile-detail-actions.spec.ts` — all 5 buttons wired.
- [ ] §W4: `logout-clears-org.spec.ts` — no header bleed across users.
- [ ] §W-STACK: `bun run dev` at apps/web green; `/` returns HTML 200.

### 6.7 MCP + agent

- [ ] §RED1: `run-with-secret.test.ts` — no subprocess output reaches LLM.
- [ ] §AGC1: `agents-create-hardening.test.ts` — 6/6 green; mirror in `enrollAgent`.
- [ ] **W3P4-001 / C-1**: `run-with-secret-long-secret.test.ts` — 9000-byte secret echoed by subprocess returns `SECRET_TOO_LARGE_FOR_RUN_WITH_SECRET` error OR `[REDACTED]`; **never** any plaintext prefix.
- [ ] **W3P10-001**: `env-var-name.test.ts` — every key in `RESERVED_ENV_KEYS` rejected as `envVarName`.

### 6.7.5 Local trust: daemon socket + identity (audit-sourced)

- [ ] **W3P12-001 / C-2**: `identity-handshake.test.ts` green — (a) fresh daemon → CLI pins fingerprint; (b) daemon restart same keypair → normal; (c) daemon restart new keypair → CLI aborts with `DAEMON_IDENTITY_MISMATCH` before any sensitive RPC is sent.
- [ ] **W1S6-001 / W3P12-002 / W3P12-003**: `socket-perms.test.ts` green — `statSync(socketPath).mode & 0o777 === 0o600` immediately after `startServer()` resolves. Parent dir mode enforced 0700.
- [ ] **W1S6-003**: `exec-auth-gate.test.ts` green — unauth raw-socket caller invoking `exec.env` receives `UNAUTHORIZED` error; no `Bun.spawn` invoked.
- [ ] **W1S6-005**: `peer-cred.test.ts` green — different-UID connection closed before any frame read.
- [ ] `~/.abadge/daemon.pub` written with mode 0644 on fresh daemon start; private key never on disk.
- [ ] `~/.abadge/config.json` schema includes `daemonFingerprint`.
- [ ] `ABADGE_*` env vars stripped from `Bun.spawn` child env.
- [ ] On upgrade: existing users see one-time "new daemon identity" prompt — documented in release notes.

### 6.7.6 Audit-coverage restoration (audit-sourced)

- [ ] **W2T12-001**: `audit-bearer-miss.test.ts` — 10 random bearer tokens generate ≥1 `agent.session_reject` row with `meta.reason="unknown_credential"` and `meta.tokenPrefix` only (never full token).
- [ ] **W2T12-002**: `audit-write-failure.test.ts` — mocked audit throw does not invert client success; warning logged; dead-letter metric incremented.
- [ ] **W2T12-003**: `audit-denied-coverage.test.ts` — one denied-branch case per category (org role, item 404, permission check, agent ownership) writes correct `denied` audit row.
- [ ] **W1S8-001**: `plugin-hooks-coverage.test.ts` — all 8 Better Auth org-plugin lifecycle endpoints write audit rows and invoke `onMemberRemoved` cascade for destructive events.
- [ ] Audit-log row-volume metrics + alerting configured (audit rate-limit enforcement + flood-suppressed marker).

### 6.8 Cross-cutting

- [ ] `bun run typecheck` — 13/13 packages clean.
- [ ] `bun run lint` — 0 errors.
- [ ] `bun run test` — all suites pass including new regression tests for §I5-RACE, §SDK10, §AUTH12, §RED1, §W4, W1S7-001, W1S7-002, W2T7-003, W3P4-001, W3P12-001, W1S6-001, W1S6-003, W1S6-005, W3P8-001, W1S9-001, W1S8-001, W1S8-002, W2T12-001, W2T12-002, W2T12-003.
- [ ] `bun run build` — FULL TURBO; 19+ routes in `@abadge/web`.
- [ ] Sweep state dir `docs/superpowers/sweeps/2026-04-22-045119-d62266/state/` archived or referenced from CHANGELOG.
- [ ] Security-audit state dir `docs/security-audit/` (under `sleepy-pascal-324a1c`) archived or referenced from CHANGELOG with a pointer to `100-PRODUCTION-CHECKLIST.md` blocker status.
- [ ] All 12 audit Week-1 blockers in `100-PRODUCTION-CHECKLIST.md` §0 marked `✅` (or `⏭️` with customer-facing risk acknowledgement).

### 6.9 Rollout

- [ ] Staging soak: 72h of synthetic traffic matching production shape; 0 `500`s except expected-failure tests.
- [ ] Load test: 500 rps sustained for 30 min across `/api/auth/signup`, `/trpc/organizations.list`, `/trpc/items.create` (SM branch); p95 < 250ms, p99 < 1s, 0 OOM.
- [ ] Security review sign-off from at least one external reviewer (or internal security team).
- [ ] Legal sign-off on `/terms` + `/privacy` content OR explicit acknowledgment that consent sentence was removed.
- [ ] Rollback plan documented (previous revision SHA + migration down-scripts for B2 and AAD migration).
- [ ] On-call runbook: rate-limit DO behavior, challenge-GC timing, §I5-RACE recovery steps (there is no recovery — document that operators must intervene immediately on report).
- [ ] **On-call runbook: MCP secret-leak detection + credential rotation** (new from audit, given W3P4-001 long-secret class).
- [ ] **On-call runbook: daemon compromise detection + master-password rotation** (new from audit, given W3P12-001 squat class).
- [ ] **AAD migration runbook:** monitoring v1-remaining count, staging soak window, decision criteria for forced-re-encrypt vs rewrap-on-read.
- [ ] **Customer communication plan:** (a) existing users' one-time "new daemon identity" prompt on upgrade, (b) if re-encrypt required for AAD migration, notification window, (c) if `run_with_secret` long-secret users exist, capability-reduction notice.
- [ ] **Pen-test re-run:** re-dispatch the W3P4 + W3P12 audit verification subagents after Tracks P1.5 + P0.5 merge; both must return green.
- [ ] **Live DAST against staging:** out of static-audit scope; run after Criticals + Highs are remediated.
- [ ] **W3P3-001 Better Auth read-side RBAC:** one curl from a non-member session against `/api/auth/organization/get-full-organization?organizationId=<other>` — verify 403/404. Document the probe in the runbook.
- [ ] Exit interview with sweep REPORT + audit report: any item from fix backlog (P4/P5) moved to v1.1 roadmap, not silently dropped.

### 6.10 Production readiness declaration

When every box above is checked:

- [ ] Tag release `v1.0.0` in git.
- [ ] Cut changeset: major bump on `@abadge/sdk` (breaking contract change for §SDK9 + §ENV2) and `@abadge/mcp` (breaking for §RED1 + W3P4-001 long-secret + W3P10-001 envVarName). Minor on `@abadge/crypto` (CRYPTO_VERSION 1 → 2 with backwards-compat fallback), `@abadge/daemon` (new TOFU keypair), `@abadge/auth` (OAuth pre-claim hardening). Patch on everything else.
- [ ] Publish changelog linking this plan + sweep REPORT.md + audit FINAL-REPORT.md + audit PRODUCTION-CHECKLIST.md.
- [ ] Deploy to production.
- [ ] First-hour smoke test: create user → verify email (new from W1S8-002) → create org → create profile (both storage modes) → create item → reveal item (AAD binding round-trip) → rotate key (verify Task 1 + Task 2 + Task A1 hold under real load) → log out → log in as different user on same machine (§W4 holds) → MCP `run_with_secret` (no output leaks; long-secret refused) → multi-org CLI unlock (§O3) → deliberate credential-stuffing probe with invalid bearer (W2T12-001 audit row written).
- [ ] **Audit re-verification:** re-dispatch the 3 independent verifier subagents from Wave 4 against the post-fix tree; they must return "all Criticals + Highs closed" to lift the `DO NOT SHIP` verdict.

---

## Self-review (writing-plans skill requirement)

**Spec coverage:** every open severity:high finding in `state/issues.md` (sweep) maps to a task in §5 or a line in §3 (non-blocking). All 3 Criticals + 12 Highs from the security audit map to blockers B24–B37 with dedicated tasks in Tracks P0.5, P1 extensions, P1.5, and P3.5. All 25 Mediums from the audit map to §3.11 (non-blocking) or are folded into existing blocker fixes. The cross-reference table in §4.12 tracks each W-ID's disposition explicitly.

**Placeholder scan:** no TBD/TODO/fill-in. Every file path is absolute or relative-to-repo. Every "fix" describes concrete code (function names, file:line, helper names). Test contracts specify file path + assertion.

**Type consistency:** `canAssignOrTransferOwnerRole`, `countOwners`, `withAdvisoryLock`, `MAX_PLAINTEXT_BYTES`, `INVARIANT_OWNER_REQUIRED`, `RATE_LIMIT` (DO binding), `OPTIONAL_ORG_HEADER_ROUTES`, `tryAsyncPreservingDomainErrors`, and new audit-sourced names `buildContentAad`, `buildDekWrapAad`, `buildRootWrapAad`, `buildServerAad`, `CRYPTO_VERSION`, `DAEMON_IDENTITY_MISMATCH`, `SECRET_TOO_LARGE_FOR_RUN_WITH_SECRET`, `RESERVED_ENV_KEYS` (shared), `tryAuthorizeOrAudit`, `PROFILE_ALREADY_BOOTSTRAPPED`, `MEMBER_AGENT_OWNERSHIP` — all used consistently across the sections they appear in.

**Two invariant deviations flagged** (both explicitly documented with rationale):
- Task 7 (§RL1-5): Durable Object is a documented deviation from AGENTS.md's "no DOs" invariant — ship-blocker + correctness requirement.
- Task A1 (W1S7-001/002): bumping `CRYPTO_VERSION` 1 → 2 with rewrap-on-read fallback is a DB-level migration that requires customer communication.

**Uncertainty flagged explicitly:**
- Task 7 offers DO **or** periodic-pruning fallback; user must choose.
- Task 14 (§W17) requires legal input to pick between real pages vs consent removal.
- Task 20 (§AU1) + Task 6c (W1S8-002) share an email provider decision point — choose once, wire in both.
- Task 18 (§RED1) is a **breaking** MCP change — requires stakeholder sign-off on capability reduction.
- Task B1 (W3P4-001) is an additional breaking MCP change (long-secret refusal) — bundle with Task 18 release notes.
- Task A1 (AEAD AAD migration) — choose rewrap-on-read (soak time) vs forced re-encrypt (downtime). Coordinate with customer-communication plan.
- §DB column migration in Task 2 needs data-migration check if prod has any `keyNonce` populated rows.
- W3P3-001 Better Auth read-side RBAC needs a one-minute staging curl probe to confirm whether there's a cross-org read leak; resolve before final sign-off.

**Sources of truth kept intact:**
- Sweep REPORT: `docs/superpowers/sweeps/2026-04-22-045119-d62266/state/REPORT.md` (iter 34, SATURATED) under `.claude/worktrees/dazzling-archimedes-53916c/`.
- Audit final report: `docs/security-audit/99-FINAL-REPORT.md` under `.claude/worktrees/sleepy-pascal-324a1c/`.
- Audit production checklist: `docs/security-audit/100-PRODUCTION-CHECKLIST.md` — this plan's §6 is a superset that adds the sweep-sourced blockers to the audit's 12 Week-1 items.
- Cross-reference: §4.12 maps each audit W-ID to its plan disposition (blocker Bn / v1.1 §3.n / folded into Bm).

**Scope summary:** **27 ship-blockers across 7 tracks** (up from 23 across 6 tracks in the sweep-only plan). 22 come from the sweep (B1–B22); B23 was the sweep's web-environment blocker; B24–B37 are the 14 new audit-sourced ship-blockers (3 Criticals + 10 Highs + 1 elevated Medium). **Estimated 3–4 engineer-weeks disciplined** for blockers P0 through P3.5. v1.1 backlog (P4 + P5) retained; audit Mediums folded into §3.11.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-04-22-production-readiness.md`. Two execution options:

**1. Subagent-driven (recommended)** — I dispatch a fresh subagent per task (1 task = 1 PR), review between tasks, fast iteration. Good fit for Tracks P0–P3 where each task has tight scope + test plan.

**2. Inline execution** — I execute tasks in this session using `superpowers:executing-plans` with checkpoint reviews. Slower but allows interactive course-correction.

Which approach?
