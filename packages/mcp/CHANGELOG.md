# @abadge/mcp

## 0.0.3

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

## 0.0.2

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
