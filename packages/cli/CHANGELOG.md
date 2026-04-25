# @abadge/cli

## 0.0.5

### Patch Changes

- ef09898: Fix new-user onboarding + dashboard hang. The CLI is unaffected at runtime —
  this changeset exists because the PR touches a test comment in
  `packages/trpc/` (a path watched by the CLI release surface) when removing
  the auto-personal-org Better Auth hook. No CLI code changed.
- c07c4cf: Gate CLI access on completed onboarding. The server now rejects org-scoped
  tRPC calls with `ONBOARDING_INCOMPLETE` (HTTP 403) when the user's
  organization has no bootstrapped profile (`storageMode='server_managed'`
  OR `wrappedRootKey IS NOT NULL`). The CLI's first call after a device-code
  approval will surface this error if the user signed up but never finished
  the profile-bootstrap step. Pre-existing `requireOrgRole` denials that
  previously surfaced as HTTP 500 (a wrapping bug in `scopedSessionProcedure`)
  now correctly surface as HTTP 403 — clients should rely on
  `AbadgeApiError.code` rather than HTTP status to distinguish error classes.
  No CLI binary code changed; the CLI just propagates the new server
  behavior.

## 0.0.4

### Patch Changes

- 4261a46: Review fixes for PR #89 — closes one P0 onboarding ship-blocker + 17 quality findings.

  **CLI (release-surface changes):**

  - `abadge vault <unlock|lock|status|change-password>` is now available as `abadge profile <unlock|lock|status|change-password>`. The `vault` top-level command is kept as a deprecated alias that forwards to the new location and prints `⚠ 'vault' is deprecated; use 'profile' instead.` on stderr. `vault` is hidden from `abadge --help`.
  - Tagline updated from "Zero-knowledge credential vault CLI" to "Credential control plane for AI agents".

  **API / web (internal, noted for release-notes coherence):**

  - **P0 — tRPC `userProcedure` tier.** New users hitting `/onboarding` no longer get `401 NO_ORG_MEMBERSHIP` on `organizations.create`. Three bootstrap endpoints (`create` / `list` / `checkSlug`) now use a new `userProcedure` that tolerates zero memberships; everything else still requires a resolved org via `sessionProcedure`.
  - **P0 — Better-Auth plugin audit coverage.** `afterCreateOrganization` / `afterDeleteOrganization` hooks emit audit rows with `surface: "auth"` so CLI device-code flows and any other caller that bypasses the tRPC `organizations.create` still produces an `org.create` audit entry.
  - Auto-seeded profile renamed `"default"` → `"internal"` so onboarding Step 2 can adopt the row instead of creating a second profile.
  - New Dashboard `ProfileCreateDrawer` at `/profiles?create=true` (the link existed; no component was reading the query param).
  - Onboarding Step 2 password label, CLI tagline, create-item drawer subtitle, profile-unlock modal text, and several other microcopy strings migrated from "vault" to "profile".
  - Register form: `autoComplete` attrs on all 4 inputs, `spellCheck={false}` on email, `minLength=12` on confirm-password, TOS moved from `/onboarding` to `/register`, password strength bar pre-renders an empty bar (no layout shift on first keystroke).
  - Per-page `<title>` via `title.template` + 17 route-leaf layouts.
  - `defaultProfileCount` on Overview fixed (was filtering by `storageMode === "server_managed"`).
  - `StorageModePicker` factored as an accessible radio-group and reused in onboarding + drawer.

- 4261a46: PR #89 review — P0 security and data-integrity fixes (Phase A). Only `@abadge/cli` is release-managed per `scripts/releases/registry.ts`; the server/tRPC/SDK/core changes below are internal but noted here for release-notes coherence.

  **Security / authorization:**

  - `items.listForAgent` now returns only items the calling agent has at least one permission on (was: every item in the agent's org, enabling metadata enumeration). See `@abadge/sdk` `AbadgeAgentClient.listItems` scoping.
  - `exec.expandEnv` / `exec.env` daemon handlers now reject reserved loader env keys (`PATH`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `LD_AUDIT`, `DYLD_*`, `NODE_OPTIONS`, `NODE_PATH`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_*`, `*_PROXY`, `BASH_ENV`, `ENV`, `IFS`, `PYTHONPATH`, `PYTHONSTARTUP`, `BUN_INSTALL`, `BUN_CONFIG_REGISTRY`, `HOME`, `USER`, `SHELL`) and keys not matching `^[A-Z_][A-Z0-9_]*$`. Prevents subprocess hijack via agent-controlled item field names.
  - `onMemberRemoved` cascade now revokes the removed member's agents, invalidates their live abs\_ sessions, and deletes permissions they granted — all atomically in a single transaction. Previously only wrote an audit row.
  - `verifyLegacyAgentIdentity` removed. Better Auth `apiKey()` plugin removed (migration 0006 dropped its table). Removed legacy API keys without a migrated `agents` row now return `UNAUTHORIZED` instead of an empty-org identity.
  - `resolveUserOrgId` for session-auth now requires `X-Abadge-Org-Id` for users with >1 org membership (returns `ORG_HEADER_REQUIRED` 400 with `meta.availableOrgIds`); single-membership users get a deterministic `ORDER BY member.createdAt ASC` fallback; zero-membership users get `NO_ORG_MEMBERSHIP` 401.

  **Error handling:**

  - `access.reveal` / `access.mount` now propagate `FieldNotFoundError` and `MultiFieldItemError` intact (previously wrapped in `UnknownException` → 500 Unknown). Clients receive `{code: "FIELD_NOT_FOUND" | "MULTI_FIELD_ITEM", hint, meta.availableFields}`. Denied audit rows emitted on field-resolution failures.
  - `profiles.rotateKey` input shape changed: `rekeyedItems: Array<{itemId, encryptedItemKey, keyNonce}>` (was `Record<string, string>` missing `keyNonce`, which caused silent decrypt failures post-rotate). Pre-flight rejects partial rekeys with `ROTATE_KEY_INCOMPLETE` listing missing itemIds.

  **Data integrity:**

  - `vault.rotateKey` (legacy) now includes `organizationId` in its WHERE clause — previously a user in multiple orgs could clobber cross-org items with wraps under a different root key.
  - Migration 0006 is idempotent: every `ADD CONSTRAINT` now preceded by `DROP CONSTRAINT IF EXISTS`; `items.label SET NOT NULL` guarded by a DO-block that raises if backfill missed rows. Safe to re-run after partial failure.
  - New migration 0007: `items.organization_id` is now `NOT NULL` with `ON DELETE CASCADE`. Org deletion now deletes items; previously orphaned them to NULL-org limbo that bypassed every isolation filter.
  - Cascade events (`onAgentRevoked`, `onItemDeleted`, `onMemberRemoved`) now emit the declared `_cascade` event-type variants (`agent.revoke_cascade`, `permission.revoke_cascade`, `item.delete_cascade`) so audit queries can distinguish primary from cascaded side-effects.

  **New error codes** (all in `@abadge/core` `ErrorCodeSchema`):

  - `LEGACY_AGENT_UNMIGRATED` (401)
  - `ORG_HEADER_REQUIRED` (400), `NO_ORG_MEMBERSHIP` (401), `ORG_MEMBERSHIP_REQUIRED` (401)
  - `ROTATE_KEY_INCOMPLETE` (400)

- 4261a46: PR #89 review — P1 quality, UX, and defense-in-depth fixes (Phase B, stacked on Phase A blockers). Only `@abadge/cli` is release-managed per `scripts/releases/registry.ts`; the SDK/core/trpc/web changes below are internal but noted here for release-notes coherence.

  **Consumer-visible SDK / API changes:**

  - `AbadgeAgentClient`: session refresh timer now `.unref()`'d (CLI processes exit cleanly after agent ops); new optional `onSessionError(err, attempt)` callback; new optional `schedulerFn` (test-seam); bounded exponential-backoff retry (30s → 60s → 120s → 240s → 300s); client flips to `sessionExpired` state after exhaustion and outgoing calls reject fast with `SESSION_REFRESH_FAILED` / 401
  - `organizations.members.list`: `email` is now `string | null` — populated only when caller is `owner` or `admin`; plain `member` callers receive `null` for every row
  - `organizations.members.getInviteInfo`: rate-limited to 10 lookups/min per (user, IP); response narrowed to `{ organizationName, organizationSlug, role, expiresAt }` — `invitationId` and `inviterUserId` removed
  - `organizations.create`: slug-race unique-violation now translated to `ConflictError` with code `SLUG_TAKEN`; org + member + default profile inserted atomically in a single transaction
  - `organizations.list`: now ordered by `member.createdAt ASC` with a hard cap of 100 per response
  - CLI `import --overwrite`: actually updates existing items now (previously silently hit `ITEM_ALREADY_EXISTS`); refuses overwrite for `zero_knowledge` items with a clear error directing the user to `abadge item delete` + re-import or `abadge item update`
  - CLI `agent register --kind remote`: no longer writes to `~/.abadge/config.json` `localAgents.cli` (remote agents aren't local)
  - New error codes: `SESSION_REFRESH_FAILED` (401), `SLUG_TAKEN` (409), `RATE_LIMITED` (429) — all in `@abadge/core`'s `ErrorCodeSchema`

  **Internal reliability / security:**

  - Web VaultProvider zeroes per-profile root keys on unmount AND on org switch
  - Onboarding: auth guard; step-2 bootstrap failure rolls back the unbootstrapped profile; resumable if tab was closed mid-flow
  - Web dashboard hint propagation: server-side `{code, message, hint, meta}` envelope now reaches every `toast.error` (was dropping `hint`)
  - CLI/MCP catch-alls no longer collapse `AbadgeApiError` — hints + codes propagate to the user
  - MCP `run_with_secret`: 8 KB pre-redaction bound (OOM DoS guard); independent stdout/stderr budgets; docs document exact-substring redaction limitations
  - MCP tool error envelope widened to emit `{error, code, hint?, meta?}` for `AbadgeApiError`
  - Cascades `onAgentRevoked` + `onItemDeleted` now transactional with bulk UPDATE … RETURNING + bulk audit INSERT
  - Invite-token URL scrubbing: `Referrer-Policy: no-referrer` on /invite/accept, /login, /register; `router.replace` strips `?token=...` from URL after read
  - `OneTimeSecretDisplay`: handles `navigator.clipboard.writeText` rejection with an error toast (stopped silently lying about copy success)
  - Onboarding vault password inputs: `autoComplete="new-password"` + non-login `name` + unmount-clear
  - Settings member-remove: confirmation dialog; delete-org dialog resets confirmText on close
  - `ResultBadge` + `CapabilityBadge`: typed against `@abadge/core` unions; cascade result renders with a distinct variant instead of undifferentiated gray

- 4261a46: PR #89 review — legacy rename cutover (Phase C, stacked on Phase B). Only `@abadge/cli` is release-managed per `scripts/releases/registry.ts`; the SDK/core/tRPC/db changes below are internal but noted here for release-notes coherence.

  **Renamed (hard cutover, no back-compat alias):**

  - `PRINCIPAL_AUTH_METHODS` → `AGENT_AUTH_METHODS` (constant)
  - `PrincipalAuthMethod` → `AgentAuthMethod` (type)
  - `PrincipalAuthMethodSchema` → `AgentAuthMethodSchema` (Effect schema)

  **Removed:**

  - `@abadge/db` schema files: `principals.ts`, `grants.ts`, `operator-tokens.ts` — and their re-exports from `packages/db/src/schema/index.ts`
  - `OperatorToken`-related test fixtures across CLI (`ABADGE_OPERATOR_TOKEN`) and tRPC auth tests (`X-Abadge-Operator-Token`)
  - CLI config legacy fields: `principalId`, `principalSecret`, `operatorUserId`, `authToken` — replaced with one-time console.warn on read + automatic file rewrite
  - Legacy-config-secret fallback in `createAgentApiClient` (retains the `ABADGE_AUTH_TOKEN` env var path as explicit opt-in)

  **New migration:**

  - `0008_drop_legacy_tables.sql` — `DROP TABLE IF EXISTS grants / principals / operator_tokens CASCADE`

  **Retained (tracked for C6.1 follow-up):**

  - `vaults` schema file + table + `vault.*` tRPC router — still used by `apps/web/src/lib/crypto-client.ts` for legacy master-password + recovery flow. Migrating to `profiles.*` is a user-visible UX coordination task and will land in a separate PR.
  - Audit-event normalization for `operator_token.*` event types in `serialize.ts` — retained so old audit rows stay queryable.

- 4261a46: PR #89 review — final wrap-up (Phase D, stacked on Phase C). Closes the 7 tracked follow-ups from Phases A/B/C. Only `@abadge/cli` is release-managed per `scripts/releases/registry.ts`; the SDK/core/tRPC/db/web changes below are internal but noted here for release-notes coherence.

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

- 1bb190d: CLI hardening for production readiness:

  - Daemon Ed25519 TOFU handshake now gates sensitive RPCs (`vault.unlock`, `item.encrypt`/`decrypt`, `exec.env`/`mount`, `auth.setSession`/`setOrg`). First run after upgrade triggers a one-time "pinned daemon identity" message and writes the fingerprint to `~/.abadge/config.json`.
  - Daemon subprocesses no longer inherit `ABADGE_*` environment variables from the CLI/daemon process (blocks child-process credential exfiltration).
  - `vault unlock` now threads the CLI's active organization so multi-org users operate against the correct profile set.
  - `--value` is rejected on TTY (shell-history leak prevention; pipe via stdin instead).
  - Error rendering uses the server-provided `hint` field from typed `AbadgeApiError` responses.

- 4261a46: v0 full stack: org-scoped tRPC routers, field-level delivery, keypair auth default, updated SDK and daemon error codes.

## 0.0.3

### Patch Changes

- fcc48e9: Improve CLI login flow with device-based OAuth, operator token support, and daemon readiness handling.

## 0.0.2

### Patch Changes

- 1767e9f: Ship the abadge CLI as a compiled Unix binary with a GitHub Releases pipeline and installer.
