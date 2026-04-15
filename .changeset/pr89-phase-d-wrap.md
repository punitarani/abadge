---
"@abadge/cli": patch
---

PR #89 review — final wrap-up (Phase D, stacked on Phase C). Closes the 7 tracked follow-ups from Phases A/B/C. Only `@abadge/cli` is release-managed per `scripts/releases/registry.ts`; the SDK/core/tRPC/db/web changes below are internal but noted here for release-notes coherence.

**Server-side + CLI polish (D1):**
- **A11.1** — `0009_invitation_schema_alignment.sql` accepts the Drizzle-proposed invitation table changes (`token_hash`, `used_at`, `used_by`, `idx_invitation_token_hash`, email nullable, FK to user). Next `drizzle-kit generate` reports "No schema changes."
- **A12.1** — Removed dead `LEGACY_AGENT_UNMIGRATED` error code from `ErrorCodeSchema` + `ErrorCode` union (A12 deleted its only emitter). Removed `@better-auth/api-key` from root `package.json` `devDependencies` + `overrides`.
- **B6.1** — `organizations.list` now returns `hasBootstrappedProfile: boolean` per org via a single SELECT DISTINCT; onboarding's resume detection collapsed from N+1 per-org `profiles.list` calls to one query.
- **B6.2** — Extracted `resolveOrCreateProfile` to `apps/web/src/app/onboarding/resolve-profile.ts` as a pure helper + 5 unit tests (happy path, PROFILE_ALREADY_EXISTS adoption, bootstrapped rethrow, non-conflict rethrow, name-mismatch rethrow).
- **B9.1** — CLI `import` tracks 5 buckets (`created`, `updated`, `skipped`, `refused`, `failed`) and exits non-zero when `failed > 0` so CI pipelines can detect partial failure.

**Web vault → profiles migration (D2, completes C6.1):**
- `apps/web/src/lib/crypto-client.ts` rewritten to call `profiles.bootstrap`/`get`/`changePassword`/`setupRecovery`/`rotateKey`/`delete` with explicit `profileId` (was `vault.*` user-scoped calls).
- `apps/web/src/lib/vault-context.tsx` `requestUnlock(profileId)` is now required; `lockVault` renamed to `lockAll` (zeros every per-profile key).
- `apps/web/src/components/master-password-modal.tsx` **deleted** — `ProfileUnlockModal` (from B4) handles every unlock prompt.
- `packages/trpc/src/server/routers/vault.ts` **deleted**; vault mount removed from router.ts.
- `packages/db/src/schema/vaults.ts` **deleted**; `vaults` re-export removed from `schema/index.ts`; `items.vault_id` column removed.
- `0010_drop_vaults.sql` drops the `vaults` table.
- `@abadge/sdk` removed: `bootstrapVault`, `getVault`, user-scoped `changePassword`/`rotateKey`/`setupRecovery`, `Vault`/`VaultResult` types.
- `packages/daemon/src/server.ts` `vault.unlock` + `vault.changePassword` RPC now require `profileId` in params. CLI threads `activeProfileId` from `~/.abadge/config.json` through `DaemonClient.unlock(profileId, password)` and `DaemonClient.changePassword(profileId, old, new)`. CLI surfaces a clear "No active profile — run `abadge profile use`" error if unset.

**Test harness (D3, closes B4.1):**
- Added `@testing-library/react@16` + `@happy-dom/global-registrator@15` to `apps/web/`.
- `apps/web/bunfig.toml` preloads `src/test-setup.ts` which registers happy-dom globally.
- First React-rendering test: `one-time-secret-display.test.tsx` verifies B12's clipboard-rejection UI path (error state when `navigator.clipboard.writeText` throws).
- B5/B7/B17 deferred-test hatches remain TODO'd for future coverage (require full tRPC + zustand + next-router mocks — harness infrastructure is ready).

**User-visible changes:**
- Web dashboard: the legacy "master password creates your vault" flow is gone. Users now unlock individual profiles (default profile is created automatically by `createOrg`).
- CLI: `abadge vault unlock` and `abadge vault change-password` now operate on the active profile (`~/.abadge/config.json`'s `activeProfileId`). Missing active profile surfaces a helpful error with a `profile use` pointer.
- SDK: `AbadgeUserClient.bootstrapVault` / `getVault` / user-scoped `changePassword` etc. are gone — migrate to the `profiles.*` methods.
