# @abadge/cli

## 0.0.8

### Patch Changes

- 85c1874: Add coverage reporting for unit and integration tests via Bun's built-in
  `bun test --coverage`. CI gains two new jobs (`test-unit`, `test-integration`)
  that upload `lcov.info` artifacts (`coverage-unit`, `coverage-integration`),
  plus a `test-web` job for the web component tests. The existing `e2e` job is
  unchanged and intentionally produces no coverage — Bun's instrumentation
  cannot see across the workerd / compiled-binary boundary, and the same code
  paths are exercised in-process by the integration bucket. Internal-only — no
  behavior change in either shipped binary; the patch bump is bookkeeping for
  the root `package.json` and `docs/DEVELOPMENT.md` files this PR touches.

  Run locally with `bun run test:cov:unit`, `bun run test:cov:integration`, or
  `bun run test:cov`. Bucket assignment lives in `scripts/coverage/buckets.ts`.

- 85c1874: Add an end-to-end test suite (`apps/e2e`) that boots a real `wrangler dev`
  API against the test Postgres and drives it through three surfaces: the
  SDK over HTTP, the compiled `abadge` CLI binary as a subprocess, and the
  `abadge-mcp` stdio server as a JSON-RPC peer. Internal-only — no behavior
  change in either shipped binary; the patch bump is bookkeeping for the
  shared `packages/trpc/` and root `package.json` files the harness adds
  test-only entries to.

  Run locally with `bun run test:e2e` after `docker compose up -d`. CI gains
  an `e2e` job gated before deploy.

- 95feb47: Schema foundation for the production revamp (additive, behaviorally
  neutral for existing tRPC callers):

  - `profiles.externalId` (nullable text) with per-org unique partial
    index for idempotent customer provisioning
  - `items.user_id` → `items.created_by` (renamed, nullable, ON DELETE
    SET NULL) — audit metadata, not ownership
  - `permissions.profile_id` (nullable) + `permissions_exactly_one_target`
    CHECK constraint + partial unique indexes for both target shapes
  - `CAPABILITIES` extended with canonical `read`/`use`; legacy four
    retained with `LEGACY_TO_CANONICAL` map; `CAPABILITY_MATRIX` marked
    `@deprecated`
  - New schemas: `ReadAccessSchema`, `UseAccessSchema`,
    `ProfileUseAccessSchema`, `ReadAccessResponseSchema`,
    `UseAccessResponseSchema`
  - `CreatePermissionSchema` is a discriminated union of `{itemId,...}`
    and `{profileId,...}` (mutually exclusive)
  - `permissions.create` rejects `profileId`-target inputs with
    `BadRequestError` until PR 2 enables them via the unified pipeline
  - Fix: `scripts/init-test-db.sh` was missing `--dbname`, preventing
    Postgres from coming up locally

- 6c5d48e: Unified access pipeline + profile-level grants for the production
  revamp:

  - `access.read` / `access.use` / `access.useProfile` tRPC procedures
    built on `resolveAccess` and `resolveProfileAccess`; both handle ZK
    and SM items, both resolve item-level and profile-level grants
  - Runtime constraint check (`access/constraints.ts`) replaces the
    compile-time `CAPABILITY_MATRIX` gating; remote+ZK and remote+use
    deny at access time with `INVALID_CAPABILITY`
  - Audit-before-decrypt invariant preserved via in-memory staging +
    transaction-scoped flush for bulk operations (phantom-audit fix)
  - `permissions.create` now accepts `{agentId, profileId, capabilities,
expiresAt?}` for profile-wide grants
  - Cascade audit on profile delete + agent revoke writes
    `permission.revoke_cascade` rows
  - New `mount_reservations` table for short-lived `use`-action mount
    handles (TTL 5 min)
  - `PermissionSchema` widened so `itemId` and `profileId` are both
    nullable (with exactly-one-target check at DB layer); CLI + web
    render profile-target rows correctly
  - Legacy `access.ciphertext` / `access.reveal` / `access.mount` /
    `access.bulkMountEnv` procedures retained untouched; deletion in
    PR 4 once CLI / MCP / SDK migrate

- 1b71722: REST `/v1` canonical surface + onboarding simplification:

  - 37 tRPC procedures annotated with `.meta({ openapi: { method, path,
tags, protect } })` covering organizations, members, profiles, items,
    agents, auth, permissions, access, and audit
  - Hand-written REST adapter (`apps/api/src/rest/v1.ts`) compiles a
    routing table from the annotations; reuses the same table to emit
    OpenAPI 3.1 at `GET /v1/openapi.json`
  - Pivoted away from `trpc-to-openapi` (peer-depends on zod ^4 while
    this codebase uses Effect Schema) — fallback was explicitly
    permitted in the plan
  - `X-Request-Id` middleware: accepts caller-supplied IDs matching
    `/^[a-zA-Z0-9_-]{6,64}$/`, otherwise mints `req_<uuid>`. Echoed on
    every response including error envelopes
  - `POST /v1/orgs` auto-creates default `server_managed` profile
    (`externalId="default"`) atomically with the org + owner member +
    audit row; return shape is `{organization, defaultProfile}`
  - Onboarding-gate removed entirely: `requireOnboardingComplete`,
    `ONBOARDING_INCOMPLETE` error code, `userHasUsableOrg` helper, and
    `onboarding-gate.ts` deleted
  - Field-level OpenAPI schemas remain generic `{type:"object"}` for
    this release; Effect Schema → JSON Schema bridging is a follow-up

- 574e61c: Client revamp across CLI, MCP, SDK, and the mount-redemption flow:

  **CLI**

  - Verb rename: `create`→`add`, `delete`→`rm`, `register`→`add`,
    `revoke`→`rm`. Deprecated aliases hidden but warn-and-route for one
    release
  - Unified `abadge run`: `--item` and `--profile` flow through
    `access.use` / `access.useProfile` → `redeemMount` → daemon
    `exec.expandEnv` / `exec.envBulk`
  - `abadge use org/profile` context switcher
  - Removed `vault.*` CLI commands entirely
  - Removed `--legacy-api-key`; keypair-only agent registration

  **MCP**

  - Merged `run_with_secret` + `run_with_all_secrets` into unified
    `use_secret` with discriminated input
  - §RED1 invariant test asserting no MCP tool's return shape contains
    `stdout` / `stderr` / `text` / raw secret value
  - Fixes the pre-existing `buildChildEnv ABADGE_* stripping` test

  **SDK**

  - Removed deprecated `AbadgeClientConfig`; exposed `Abadge.User` /
    `Abadge.Agent` namespace
  - `agent.access.read(itemId, opts?)` / `agent.access.use(target, opts)`
    replace three legacy methods
  - `AbadgeUserClient` reshaped to namespaced operations

  **Server-side mount redemption**

  - New `access.redeemMount` tRPC procedure with atomic UPDATE/RETURNING
  - Daemon stays auth-agnostic — CLI redeems and hands envelope to
    existing daemon RPCs

- ded5935: Final polish PR for the production revamp: web dashboard, docs
  rewrite, verification log.

  **Web**

  - Single-step org-create onboarding (default profile auto-created
    server-side by PR 3); no resume-profile triage
  - Profile list shows `externalId`; create drawer adds an opt-in
    Zero-knowledge toggle (default `server_managed`)
  - Permissions UI: target-type radio (Item / Profile), canonical
    `read` / `use` checkboxes only (legacy four hidden), blast-radius
    confirmation dialog on profile-target `read`
  - Permissions list renders `profile:<name>` pills for profile-target
    grants

  **Docs (`docs/`)**

  - `docs/API.md` rewritten as REST endpoint reference
  - `docs/CAPABILITY_MATRIX.md` → `docs/CAPABILITIES.md` (one page)
  - `docs/CLI.md` reflects new verbs and unified `run` command
  - `docs/MCP.md` reflects unified `use_secret`
  - Zero `vault.*` references remain in production docs

  **Mintlify (`apps/docs/`)**

  - Added `use_secret.mdx`, removed `run_with_*` pages, renamed
    `vault.mdx` → `profile-security.mdx`
  - New permissions concept page reflects `read` / `use`
  - New `migration/v0-to-v1.mdx` migration guide

  **Verification**

  - `docs/superpowers/2026-05-12-revamp-verification.md` captures the
    cross-PR verification log + deferred follow-ups

## 0.0.7

### Patch Changes

- af6fbd7: Allow granting multiple capabilities per `(agent, item)` in one atomic call. `permissions.create`
  now accepts `capabilities: Capability[]` (non-empty, deduplicated) and writes every row inside
  a single Postgres transaction — partial grants are never observable. Matrix violations and
  duplicates are pre-checked, and the error envelope's `meta.invalidCapabilities` /
  `meta.duplicateCapabilities` lists every offender so the UI/CLI can recover precisely.

  CLI: `abadge permission create --capability X --capability Y` and `--capability X,Y,Z`
  both work — repeat the flag or comma-separate. Single-cap grants stay one short flag.

  Breaking change to the public SDK shape: `CreatePermissionInput.capability` (singular)
  becomes `capabilities: Capability[]`; `PermissionResult` is removed in favor of
  `PermissionListResult`. The DB row layout is unchanged; the audit log invariant
  (one `permission.create` row per granted capability) is preserved.

- 1c77662: Follow-up to PR #116 review feedback. Two small fixes:

  - `abadge agent register` now rejects `--json` + `--mcp-config` up front instead of accepting both. The combination produced a single nested JSON document that worked, but mixing a script-oriented flag (`--json`) with a human-paste flag (`--mcp-config`) is confusing. Use `abadge agent register --json` for scripts, then `abadge agent mcp-config <id>` to print the snippet.
  - `install.sh` now emits an explicit `warning:` line on stderr when `ABADGE_INSTALL_BASE_URL` is set without a scoped version. Previously a multi-package install (`ABADGE_INSTALL_PACKAGE=all`) would silently skip every package without explanation; the operator now sees which env var to set.

- 0c0f6e3: Add `abadge run --all` and the `run_with_all_secrets` MCP tool — bulk env-var
  injection scoped to the active profile.

  `abadge run --all -- <cmd>` injects every item in the active profile that the
  agent has `mount_env` on, with each item's label normalized to a POSIX env-var
  name (e.g. `openai-api-key` → `OPENAI_API_KEY`). Profile is the trust boundary:
  items in other profiles are NEVER injected, even if the agent has grants on
  them. Capped at 256 items per call. Each included item produces its own
  `access.mount_env` audit row tagged `meta.viaBulk = true`. Hard-rejects on
  env-var collisions and on labels that normalize to reserved keys
  (`PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, …).

  The MCP server gets the equivalent `run_with_all_secrets` tool with the same
  profile-scoped semantics and the same §RED1 contract — subprocess stdout/stderr
  is never forwarded to the model.

  `abadge run --item <id>` continues to work unchanged. Multi-field items
  (login, certificate, ssh_key) are silently skipped from `--all` — use
  `--item --field` for those.

  Server-side: new tRPC mutation `access.bulkMountEnv`. Daemon: new RPC
  `exec.envBulk`. Core: new `labelToEnvKey` helper. SDK: new
  `bulkAccessMountEnv` method on `AbadgeAgentClient`. (Internal packages
  @abadge/core, @abadge/sdk, @abadge/trpc, @abadge/daemon are versioned
  implicitly via the cli/mcp release pipelines — they're listed in the
  release registry's `changePaths` for both binary releases.)

- 55beb2d: Ship `abadge-mcp` as a distributable binary. The MCP server now releases through the same
  GitHub Actions pipeline as the CLI: per-platform `bun --compile` artifacts, SHA256-verified
  tarballs, and the existing `install.sh` installer (extended to support
  `ABADGE_INSTALL_PACKAGE={cli|mcp|all}` plus scoped `ABADGE_CLI_VERSION` /
  `ABADGE_MCP_VERSION` pins). `install.sh` defaults to installing both binaries when invoked
  without env vars.

  Add `--mcp-config` to `abadge agent register` and a standalone `abadge agent mcp-config <id>`
  subcommand. Both emit a paste-ready Claude Desktop `mcpServers` JSON snippet using absolute
  paths so it works under launchd/systemd-spawned MCP clients that do not inherit
  `~/.abadge/bin` in `$PATH`.

- d13b54c: Tune the React `createTrpcQueryClient` defaults in `@abadge/trpc` for SPA-style dashboard caching: 1-minute `staleTime`, 10-minute `gcTime`, `refetchOnWindowFocus: false`, `refetchOnReconnect: "always"`. The CLI does not instantiate the React QueryClient (it only uses `createNodeTrpcClient`), so this changeset documents that the CLI's release surface includes the touched `packages/trpc/` file even though there is no behavior change for CLI users.

## 0.0.6

### Patch Changes

- 90c44ef: `organizations.create` no longer seeds a default `internal` profile. The
  mutation now only inserts the org row and the owner-member row in a single
  transaction; callers create profiles explicitly through `profiles.create`
  (plus `profiles.bootstrap` for zero-knowledge profiles). This removes the
  `storageMode` / `wrappedRootKey` / `kdfSalt` / `kdfParams` /
  `recoveryWrappedRootKey` inputs and the `profileId` field from the
  mutation's response shape.

  CLI impact is type-only: the SDK `createOrganization` callable already
  discarded `profileId`, and the CLI does not read storage-mode parameters
  on org creation. The onboarding gate (`ONBOARDING_INCOMPLETE`) continues
  to enforce that scoped operations require at least one bootstrapped
  profile.

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
