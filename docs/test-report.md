# Test Report: Zero-Knowledge Vault Architecture Rewrite

**Date:** 2026-04-01
**Branch:** feat/zk-vault-final
**Commit:** e344bbc (before fixes), updated with bug fixes

## Automated Checks

| Check | Result | Notes |
|-------|--------|-------|
| `bun run format` | PASS | 129 files, no fixes needed |
| `bun run lint` | PASS | 0 errors, 2 warnings (cognitive complexity in prompt.ts and principals/page.tsx — acceptable) |
| `bun run typecheck` | PASS | 12/12 packages |
| `bun run build` | PASS | API (Wrangler dry-run), Web (Next.js 14 pages), SDK (tsc) |
| `bun test` | PASS | 52 tests (33 crypto + 19 core), 93 expect() calls |
| `bun run db:generate` | PASS | 1 migration file: `0000_rich_thena.sql` (12 tables) |
| `bun run db:migrate` | PASS | Applied successfully on fresh database via Doppler |

## API Integration Tests (curl)

All tests run against local API on `localhost:8787` with Doppler env vars.

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Unauthenticated GET /v1/vault | PASS | Returns 401 `{"error":"Unauthorized"}` |
| 2 | Unauthenticated GET /v1/items | PASS | Returns 401 |
| 3 | Unauthenticated GET /v1/principals | PASS | Returns 401 |
| 4 | Unauthenticated GET /v1/grants | PASS | Returns 401 |
| 5 | Unauthenticated GET /v1/audit | PASS | Returns 401 |
| 6 | Invalid Bearer token POST /v1/access/reveal | PASS | Returns 401 `{"error":"Invalid API key"}` |
| 7 | Vault bootstrap with invalid body | PASS | Returns 401 (auth check before validation) |
| 8 | Health check | PASS | Returns `{"status":"ok"}` |
| 9 | Sign up user | PASS | Returns user object + session token |
| 10 | Sign in user | PASS | Returns user object + session token |
| 11 | GET /v1/vault (no vault) | PASS | Returns 404 `{"error":"Vault not found"}` |
| 12 | PUT /v1/vault/bootstrap | PASS | Returns 201 with vault ID |
| 13 | GET /v1/vault (exists) | PASS | Returns vault metadata (wrappedRootKey, kdfSalt, kdfParams, keyVersion) |
| 14 | Duplicate vault bootstrap | PASS | Returns 409 `{"error":"Vault already exists"}` |
| 15 | Create ZK item | PASS | Returns 201 with item ID |
| 16 | Create server-managed item | PASS | Returns 201 (after bug fix — see below) |
| 17 | List items | PASS | Returns flat array of items with metadata |
| 18 | Get ZK item | PASS | Returns ciphertext + encryptedItemKey + metadata |
| 19 | Get server-managed item | PASS | Returns metadata only (no ciphertext exposed) |
| 20 | Create remote principal | PASS | Returns principal + one-time API key with `abg_` prefix |
| 21 | Create local_cli principal | PASS | Returns principal + one-time API key with `abl_` prefix |
| 22 | List principals | PASS | Returns both principals |
| 23 | Grant reveal_plaintext to remote on managed item | PASS | Returns grant ID |
| 24 | Grant read_ciphertext to remote on ZK item | PASS | Rejected: `"Remote principals cannot access zero-knowledge items"` |
| 25 | Remote principal reveal managed item | PASS | Returns decrypted payload with all fields |
| 26 | Remote principal ciphertext access | PASS | Rejected: `"Remote principals cannot access ciphertext"` |
| 27 | Remote principal reveal ZK item | PASS | Rejected: `"Cannot reveal zero-knowledge items via API"` |
| 28 | Audit log query | PASS | Returns 10 entries with cursor pagination, all events logged |

## Web App Tests (Playwright)

All tests run against local Next.js on `localhost:3000` with API on `localhost:8787`.

| # | Test | Result | Notes |
|---|------|--------|-------|
| W1 | Login page renders | PASS | Email/password form + social login buttons |
| W2 | Sign in with credentials | PASS | Redirects to /items after login |
| W3 | Vault unlock gate (existing vault) | PASS | Shows "Unlock vault" with master password prompt |
| W4 | Registration page | PASS | Name/email/password form |
| W5 | New user vault bootstrap | PASS | Shows "Set up your vault" with password + confirmation |
| W6 | Vault bootstrap with master password | PASS | Creates vault, shows dashboard |
| W7 | Dashboard layout | PASS | Sidebar: Items, Principals, Grants, Audit log, Settings, Lock vault, Sign out |
| W8 | Items list (empty) | PASS | Shows "No items yet" |
| W9 | Create item form | PASS | Name, storage mode radio (ZK default), value textarea |
| W10 | Create ZK item via browser | PASS | Client-side encryption, redirects to items list |
| W11 | Items list shows ZK item | PASS | After bug fix — shows ID, "Zero-knowledge" badge, timestamps |
| W12 | Vault lock on page reload | PASS | Expected ZK behavior — root key lost, unlock prompt shown |
| W13 | Vault unlock with master password | PASS | Argon2id derivation + XChaCha20-Poly1305 unwrap succeeds |
| W14 | Principals page | PASS | Shows empty state with "Register your first principal" |
| W15 | Sidebar navigation preserves vault state | PASS | Navigating Items→Principals→Audit via sidebar keeps vault unlocked |
| W16 | Audit log page | PASS | After bug fix — shows entries with correct field mapping |

## Bugs Found and Fixed

### BUG-1: Server-managed item creation — Internal Server Error (FIXED)

**Symptom:** `POST /v1/items` with `storageMode: "server_managed"` returned 500.

**Root cause:** `ENCRYPTION_KEY` env var was 64 bytes (512 bits) but AES-256-GCM requires 32 bytes. The `importKey` function passed the raw bytes to WebCrypto which rejected the key size.

**Fix:** Added key length truncation in `packages/crypto/src/server/encrypt.ts:importKey()` — if key is longer than 32 bytes, use first 32 bytes. Also fixed `toArrayBuffer` helper to handle `Uint8Array` byte offset correctly (was using `.buffer` directly which can share underlying memory with wrong offsets).

**Files:** `packages/crypto/src/server/encrypt.ts`

### BUG-2: Items list showing "No items yet" despite items existing (FIXED)

**Symptom:** After creating a ZK item, the items list page showed "No items yet."

**Root cause:** Two issues:
1. `page.tsx:37` used `data.items ?? []` but the API returns a flat array, not `{ items: [...] }`.
2. `page.tsx:107` checked `item.storageMode === "zk"` but API returns `"zero_knowledge"`.
3. `page.tsx:20` expected a `name` field that doesn't exist (ZK item metadata is encrypted).

**Fix:** Changed to `Array.isArray(data) ? data : []`, fixed storage mode comparison to `"zero_knowledge"`, display truncated item ID instead of name.

**Files:** `apps/web/src/app/(dashboard)/items/page.tsx`

### BUG-3: Storage mode mismatch across all web pages (FIXED)

**Symptom:** Web pages used `"zk"` and `"managed"` as storage mode values instead of `"zero_knowledge"` and `"server_managed"`.

**Root cause:** Web agent used short-form enum values that don't match the API contract defined in `@abadge/core`.

**Fix:** Replaced all `"zk"` → `"zero_knowledge"` and `"managed"` → `"server_managed"` across items/new, items/[id] pages.

**Files:** `apps/web/src/app/(dashboard)/items/new/page.tsx`, `apps/web/src/app/(dashboard)/items/[id]/page.tsx`

### BUG-4: API response shape mismatch in principals, grants, audit pages (FIXED)

**Symptom:** Principals, grants, and audit pages showed empty state despite data existing.

**Root cause:** Web pages expected `data.principals`, `data.grants`, `data.logs` but API returns flat arrays for list endpoints and `{ entries, nextCursor }` for audit.

**Fix:** Changed all list fetches to `Array.isArray(data) ? data : []`. Changed audit to use `data.entries`.

**Files:** `apps/web/src/app/(dashboard)/principals/page.tsx`, `apps/web/src/app/(dashboard)/grants/page.tsx`, `apps/web/src/app/(dashboard)/audit/page.tsx`

### BUG-5: Audit page crash — Invalid time value (FIXED)

**Symptom:** Audit log page threw `RangeError: Invalid time value` and showed error overlay.

**Root cause:** Page used `log.timestamp` but API returns `occurredAt`. Also referenced `log.metadata` instead of `log.meta`, and non-existent `principalName`/`itemName` fields.

**Fix:** Updated interface and all field references to match API response: `timestamp` → `occurredAt`, `metadata` → `meta`, removed `principalName`/`itemName`.

**Files:** `apps/web/src/app/(dashboard)/audit/page.tsx`

### BUG-6: ArrayBuffer type compatibility in crypto server module (FIXED)

**Symptom:** TypeScript error `Type 'ArrayBuffer | SharedArrayBuffer' is not assignable to type 'ArrayBuffer'` in Next.js typecheck.

**Root cause:** `Uint8Array.buffer.slice()` returns `ArrayBufferLike` which includes `SharedArrayBuffer`, but WebCrypto expects `ArrayBuffer`.

**Fix:** Added explicit `as ArrayBuffer` cast in `toArrayBuffer` helper.

**Files:** `packages/crypto/src/server/encrypt.ts`

## Known Issues (Not Fixed — Deferred)

### ISSUE-1: Recovery key not displayed after vault bootstrap

**Severity:** Medium

The vault bootstrap flow creates a recovery key and calls the recovery setup API, but the recovery key display may be skipped or shown too briefly in the UI. The VaultGate component should show the recovery key with a clear "save this" warning and require user acknowledgment before proceeding.

### ISSUE-2: `/v1/auth/providers` returns 404

**Severity:** Low

The web app calls `GET /v1/auth/providers` to discover available social login providers, but this endpoint was removed in the rewrite (it was part of the old `routes/auth.ts`). The error is handled gracefully — social buttons still show. To fix: either add the endpoint back or remove the client-side discovery call and always show both buttons.

### ISSUE-3: Item names not visible in items list for ZK items

**Severity:** Low (by design)

ZK items have all metadata encrypted inside the ciphertext. The items list shows truncated IDs instead of names. To show names, the client would need to decrypt each item just to render the list. This is a UX tradeoff of the ZK model. Consider: adding an optional encrypted name field that's decrypted client-side for display, or using a client-side index.

### ISSUE-4: Cognitive complexity warnings

**Severity:** Low

Two functions exceed Biome's complexity threshold (15):
- `packages/cli/src/prompt.ts:31` — password input handler (17)
- `apps/web/src/app/(dashboard)/principals/page.tsx:119` — table row renderer (22)

Both are acceptable and functional.

## Security Invariant Verification

| Invariant | Status | Evidence |
|-----------|--------|----------|
| Server never sees ZK item plaintext | VERIFIED | API accepts only ciphertext for ZK items; no decrypt code path exists |
| Remote principals cannot access ZK items | VERIFIED | Grant creation rejects remote+ZK; access routes deny remote ciphertext |
| Every access attempt is logged | VERIFIED | Audit log shows both allowed and denied entries |
| API keys are hashed before storage | VERIFIED | Only `secretHash` stored in principals table |
| Vault key never sent to server in plaintext | VERIFIED | Only `wrappedRootKey` stored; KEK derivation is client-side only |
| Audit log contains no secret material | VERIFIED | Entries contain only IDs, event types, results, metadata |
| Server-managed encryption uses proper key length | VERIFIED | Key truncated to 32 bytes (256 bits) for AES-256-GCM |
| Per-item DEKs provide isolation | VERIFIED | Crypto tests confirm different DEKs per item, wrong key fails |

## Test Environment

- **Runtime:** Bun 1.3.0
- **API:** Hono on Wrangler local dev (Cloudflare Workers emulation)
- **Web:** Next.js 15.5.14 dev server
- **Database:** Local PostgreSQL via Doppler env injection
- **Browser:** Playwright (Chromium) via MCP
- **Crypto:** @noble/ciphers 1.2.1 + @noble/hashes 1.7.1
