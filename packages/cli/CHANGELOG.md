# @abadge/cli

## 0.0.11

### Patch Changes

- 49bb890: Fix CLI developer-experience papercuts: `org add` now accepts `--json` so scripts can create an organization and capture its id in one step; the no-organization error renders a CLI-actionable hint (`abadge org add` / `abadge org use`) instead of pointing at the web-only onboarding flow; the stale `abadge profile create` hint now points at the real `abadge profile add` subcommand; `run` rejects the silently-ignored combinations of `--all`/`--expand-env` with `--field`/`--env-var` up front instead of dropping them; and `profile list --json` emits a clean DTO (`id`, `name`, `externalId`, `description`, `storageMode`, `keyVersion`, `createdAt`, `updatedAt`) rather than leaking wrapped-key and KDF columns.
- f12c72e: Add `abadge profile bootstrap [name-or-id]` to initialize a zero-knowledge profile's master password from the CLI. Previously the CLI could create a ZK profile but never bootstrap it, so zero-knowledge mode — the flagship client-side-encryption feature — was unusable from the CLI (you could only bootstrap via the web/SDK). Bootstrap derives the KEK locally (Argon2id), wraps a fresh root key, sets up a recovery key, and binds the wrap AAD to `{profileId, keyVersion:1}` exactly like the web flow, so a CLI-bootstrapped profile is unlockable via `abadge profile unlock`. `profile add --storage-mode zero_knowledge` now points users to the bootstrap step.
- 8e5303e: `permission create` now accepts `--profile-id` to grant the canonical `read`/`use` capabilities across an entire profile, and requires exactly one of `--item-id`/`--profile-id`. Passing canonical `read`/`use` with `--item-id` now fails fast with an actionable hint (use `--profile-id`, or a legacy item capability) instead of a confusing server-side rejection. Fixes the dead-end where the CLI help advertised `read`/`use` but the CLI had no way to grant them.
- ef78690: Stop collapsing every local-daemon failure into a single "start the daemon" message. `abadge run` and the MCP zero-knowledge decrypt path now distinguish a locked vault (→ `abadge profile unlock`), a daemon that isn't running (→ `abadge daemon start`), and other failures, so a user whose daemon is up but locked is no longer told to start it. The MCP messages address the human operator (an agent can't unlock a profile). `abadge profile unlock` now also states the 15-minute auto-lock window.
- f858681: docs: reconcile reference docs with the current code and remove deprecated references. Corrects the MCP tool name (`use_secret`), the canonical `read`/`use` capability model (including the item-target vs profile-target grant distinction), keypair-only agent auth, and the CLI permission/run examples.
- 202a50b: mcp: on a failed `use_secret` run that produced (withheld) output, return a static, secret-free `hint` explaining that stdout/stderr were suppressed per RED1 and pointing at `mount_secret` for output inspection. The hint is a fixed constant containing no subprocess output, and is omitted entirely on success.
- b8c3f28: Fix `item add` silently storing nothing when the value is piped without a trailing newline (e.g. the quickstart's `echo -n 'secret' | abadge item add`). Piped (non-TTY) stdin is now read to EOF as the value, and prompt chrome is written to stderr so `--json` output stays clean.
- b1ea9ee: Observability and UX polish:

  - **Permission-denied hints now name the human actor and a copy-pasteable command.** When an agent is denied access (item-target `access.*` and the canonical `read`/`use` pipeline), the `ForbiddenError` hint explains that a person with management access must grant it — via the dashboard Permissions page or `abadge permission create --agent-id <id> --item-id <id> --capability <cap>` — and notes the agent cannot grant its own access. The agent/item/capability are interpolated into the command and attached to `error.meta` for machine consumers. This flows through MCP error responses. Authorization is unchanged (messaging only).
  - **`abadge audit` gains filter flags** `--result`, `--agent-id`, `--item-id`, and `--event-type`, passed through to the audit query the server already accepts. `--json` still works.
  - **`abadge agent mcp-config <id>` resolves the agent via the API** instead of requiring a match in `~/.abadge/config.json`. An agent registered with `--json` (which never writes the local `mcp` config slot) can now produce a Claude Desktop snippet, as long as its private key exists locally at `~/.abadge/agents/<id>.ed25519.jwk`. A missing key file now produces a clear, distinct error.

- 3110185: Repair the REST `/v1` facade (every route returned HTTP 500 due to a tRPC v11 caller-shape guard bug) and coerce the audit `limit` query param. Touches `packages/trpc`, which the CLI and MCP release binaries bundle.
- cb2d051: SDK ergonomics: immutable-update footguns now throw, and `AbadgeApiError` carries `requestId`. `packages/sdk` is bundled into the CLI and MCP release binaries.

## 0.0.10

### Patch Changes

- 9aeabd9: Bound the `app_runtime` database role to a 15s `statement_timeout` via migration 0029 (`ALTER ROLE`), so a runaway query cannot pin a scarce connection-pool slot. Set as a role default — a postgres-js driver GUC would be reset by Hyperdrive's transaction pooler — and a query canceled by it (SQLSTATE 57014) maps to a retryable 503. Effective once the app connects as `app_runtime` (cutover pending per the least-privilege runbook); a harmless no-op for the owner role until then, and deliberately not set on the owner (whose migrations + roadmap backfill can legitimately exceed 15s). cli/mcp patch — release-surface dependency closure (the verifying test assertion lives under `@abadge/trpc`); no CLI/MCP behavior change (DB role config).
- f898804: Enable Better Auth session `cookieCache` (maxAge 60s) so the dashboard's per-request session validation reads a short-lived signed cookie instead of hitting the database on every authenticated request — removing the per-request `getSession` round-trip on the connection-pool-bound system. Scope: caches ONLY session identity; org-membership authorization stays a live per-request query (immediate org-revocation preserved), and agent `abs_` / personal `abu_` auth never read this cookie. Only session validity (logout/expiry/revocation) lags ≤ maxAge (60s); sensitive Better Auth endpoints bypass via `disableCookieCache`. cli/mcp patch — release-surface dependency closure (the test-helper change is under `@abadge/trpc`); no direct CLI/MCP behavior change (server-side auth config).
- 20b0bc4: Add a comprehensive `examples/` tree (10 runnable examples across the SDK, CLI, MCP, and HTTP API) and wire it into the docs: a new Mintlify Examples page, navigation entry, and cross-links from the quickstart, SDK installation, and MCP Claude Desktop pages. Also corrects a stale CLI flag in the MCP Claude Desktop doc (`--agent`/`--item` → `--agent-id`/`--item-id`) and the mount delivery wording (`mountType: file` → `delivery: file`). Documentation-only — no CLI or MCP behavior change; patch to ship the updated release-surface docs (`README.md`, `apps/docs/mcp/`).
- 0e3cc0e: Fix agent session-exchange 500: canonicalize Ed25519 public-key JWKs to `{kty,crv,x}`. Node WebCrypto stamps a non-standard `alg:"Ed25519"` member on exported public-key JWKs, which Cloudflare Workers' `importKey` rejects — surfacing as a 500 during agent session-exchange. The server now canonicalizes registered/stored keys (also self-healing keys already in the DB at verify time) and `verifyEd25519` fails closed: a malformed key or signature is an audited 401, never a 500. cli/mcp patch — release-surface dependency closure (both depend on `@abadge/crypto` + `@abadge/trpc`); no direct CLI/MCP behavior change.
- 31d50cb: Fix silent row drops in keyset pagination when >100 rows share an identical `created_at` timestamp (e.g. rows written in a single transaction). The cursor now carries microsecond-precision epoch values via `(EXTRACT(EPOCH FROM created_at) * 1000000)::bigint` instead of a millisecond-truncated ISO-8601 date string, so the equality branch of the `(createdAt DESC, id DESC)` predicate correctly matches all rows in the same microsecond group. Affects `items.list`, `items.listForAgent`, `agents.list`, and `permissions.list` — and the SDK `drainPages` helper that wraps them. Server-side `@abadge/trpc` fix; patch to satisfy the release-surface dependency closure (cli/mcp depend on `@abadge/trpc`).
- 7f4a4c3: Throttle `last_used_at` writes on the hot authentication path. Previously every authenticated request issued an `UPDATE … SET last_used_at = now()` on `user_api_keys` / `agents` / `agent_sessions`; now the write only fires when the stored timestamp is null or older than 15 minutes (the staleness check lives in the `UPDATE`'s `WHERE`, so a fresh row matches zero rows and writes nothing). This removes per-request row-lock/WAL contention on the connection-pool-bound system. `last_used_at` is display-only — auth/expiry/revocation read `expires_at`/`revoked_at` — so ≤15-min staleness is harmless. cli/mcp patch — release-surface dependency closure (both depend on `@abadge/trpc`); no direct CLI/MCP behavior change.
- e045b27: Fix the onboarding/dashboard dead-end where a stale `activeOrgId` persisted in the browser (and sent as the `X-Abadge-Org-Id` header) made `organizations.list`/`create`/`createPersonal` fail with `ORG_MEMBERSHIP_REQUIRED`, stranding freshly-signed-up or account-switched users on the "We couldn't load your organizations" error card with no recovery. The bootstrap-safe resolver now treats a foreign `X-Abadge-Org-Id` as "no org context" and falls through to membership resolution, letting the client discover and repair its org context; org-scoped routes still reject a foreign header strictly. Server-side `@abadge/trpc` fix — patch to satisfy the release-surface dependency closure (cli/mcp depend on `@abadge/trpc`); no CLI/MCP behavior change.
- 8bfbb0d: Map transient database failures to a retryable HTTP 503 (`ServiceUnavailableError`) on both the tRPC and v1 REST surfaces, instead of an opaque 500 — clients get a `Retry-After` backpressure signal and capacity blips stop being misclassified as 500-class bugs. Detection reads the SQLSTATE/socket code through Drizzle's `.cause` wrapper (connection class `08`, `53300`/`53400`, `57014`, `57P0x`, socket codes); genuine application errors (e.g. `23505` unique_violation) still map to 500 and never leak constraint names. The transient code is logged server-side (code only, never the message) so a recurring fault stays diagnosable. cli/mcp patch — release-surface dependency closure (both depend on `@abadge/core` + `@abadge/trpc`); no direct CLI/MCP behavior change.

## 0.0.9

### Patch Changes

- 519042a: Route the agents router through `scopedDb` (AB-0010 PR-B). Org-scoped reads use `findMany`/`findFirst` (the org filter is baked in), inserts use `scope.insert`, and the by-PK update / agent-context self-fetch / revoke transaction use the escape hatch — every query preserved exactly, with the rotate and revoke updates also AND-ing in the org scope so the writes are self-defending. `agents.ts` no longer imports tenant tables directly and is removed from the import-ban allowlist. No behavior change.
- e74f0bc: Add the org-scoped data-access layer foundation (`scopedDb`) — internal AB-0010 infrastructure. No behavior change yet: `scopedDb(executor, orgId)` bakes the `organization_id` filter into reads and inserts so a forgotten WHERE clause becomes structurally impossible, and a CI import-ban ratchet prevents new direct tenant-table access. Routers migrate onto it in follow-up PRs.
- 31db22d: Add a Postgres row-level-security backstop (AB-0011) behind the AB-0010 scoped DAL. Migration `0021` enables FORCE RLS on `items`/`profiles`/`agents`/`permissions` with an org-isolation policy keyed on the `app.current_org` GUC, which `scopedDb.run()` sets via a transaction-local `set_config` as the first statement of every scoped transaction. The policy fails closed: an unset/wrong context yields zero rows, never an unfiltered leak. RLS enforces for the NOSUPERUSER/NOBYPASSRLS runtime role (AB-0012); the superuser/owner is unaffected, so migrations and admin tooling are unchanged. No behavior change for the current connection.
- 2d501df: Activate the AB-0011 row-level-security backstop so the app can run as the NOBYPASSRLS `app_runtime` role: the org-scoped tRPC middleware now runs each request inside a transaction that sets the `app.current_org` GUC the FORCE-RLS policies read, exempt the `agents` table from RLS (it is read pre-org-context during auth), and set the GUC explicitly on the multi-org and member-removal paths that cannot use the request middleware.
- 4260cee: AB-0022: audit authorized server_managed reads that fail AES-GCM decryption; AB-0010: route all tenant-table queries through scopedDb in all routers (audit, permissions, items, access, auth, organizations, profiles)
- a390161: Document the AES-GCM random-IV ceiling and rotation trigger (AB-0031) in `docs/SECURITY.md` and add the server-managed key-rotation runbook (AB-0090) at `docs/runbooks/key-rotation.md`, plus a master-key rotation test (rewrap the per-profile DEK with content untouched). Documentation + test only — no runtime behavior change.
- b01f0c0: Track server-managed encryption count per profile; warn at 2^27 uses to flag approaching AES-GCM nonce saturation (§AB-0031).
- 8f05d1d: Add key commitment to the server-managed AEAD envelope (AB-0032). New server-managed writes are now `serverKeyVersion = 4`: a 32-byte HMAC-SHA256(DEK, fixed-context) commitment is prefixed to the AES-GCM ciphertext and verified constant-time on decrypt, binding each ciphertext to the exact per-profile DEK (defeats AES-GCM key-confusion / partitioning-oracle attacks). v1–v3 rows decrypt unchanged. No API or behavior change for callers.
- bd68899: Agent records, permission grants, and audit entries can now carry a null actor-user.

  §AB-0043 makes an agent's lifecycle org-scoped rather than tied to its creating user: deleting that user now orphans the agent — along with its grants and sessions — instead of cascade-deleting them. As a result, three public types gain nullable fields: `Agent.createdBy`, `Permission.grantedBy`, and `AuditEntry.userId` are now `string | null`. Code that assumed these were always present (e.g. `agent.createdBy.slice(...)`) must handle the orphaned/ownerless case.

- 6cf2570: Remove deprecated flat methods from AbadgeUserClient and AbadgeAgentClient; all functionality is accessible via the namespace API (§AB-0080).
- 7b8e830: Paginate the agent item list (`items.listForAgent`) and drain it client-side (AB-0010). The agent's grant set was returned unbounded; it now uses the same `(createdAt DESC, id DESC)` keyset (cursor/limit, max 100) as the session list. `AbadgeAgentClient.listItems` transparently drains every page, so MCP `list_items` and other agent consumers still see the full grant set with no change. Closes the unbounded-agent-list footgun flagged on the pagination PR.
  </content>
  </invoke>
- f30aa81: Enforce `audit_logs` append-only at the database (AB-0020). Migration 0018 installs a `BEFORE UPDATE/DELETE` immutability trigger that RAISEs, so audit rows cannot be rewritten or deleted by any role — a bug, compromised Worker, or insider can no longer silently erase evidence of an unauthorized access. INSERT still succeeds; TRUNCATE (row-trigger-bypassing) is left for the complementary REVOKE from a least-privilege application role (AB-0012).
- b88efee: Pull upstream security fixes for bundled transitive dependencies via root `overrides` — `kysely` ≥0.28.17 (JSON-path injection), `fast-uri` ≥3.1.2 (host confusion + path traversal, reached through the MCP SDK), and `fast-xml-builder` ≥1.1.7. No API or behavior changes; this is dependency hardening that flows into the CLI and MCP binaries. The CI dependency-audit gate is now blocking, backed by an expiring allowlist (AB-0104).
- b928003: Pin the access pipeline's audit invariants with regression tests (AB-0022): every denied/expired agent access is audited before the error is raised, and a granted mount reservation plus its "allowed" audit row are written in one transaction (a forced audit-insert failure rolls back the reservation — zero reservations, zero allowed audit rows). Also correct the unauth-bearer audit-dedup comment to document its per-isolate, best-effort nature on Workers (AB-0021).
- 974c475: Add a best-effort second audit sink for tamper detection (AB-0024). Every committed `audit_logs` row is mirrored to the structured log stream (an `audit_mirror` line, shipped off-box via Workers Logs → Logpush to an append-only store), so a DB-side deletion is detectable by comparing the two sinks. The mirror is best-effort and never throws, so sink failure cannot block or fail a user/agent request. `scripts/audit-divergence-check.ts` compares the DB against a sink export and flags any audit event present in the sink but missing from the DB.
- b8afd63: Add auth.md agentic registration (WorkOS `anonymous` → user-claimed OTP flow). An agent can `POST /agent/auth` to self-register an unclaimed **personal account** (a placeholder-email owner + personal org + default `server_managed` profile) and receive an `abu_` personal API key + a `clm_` claim token; a human then claims it with an emailed 6-digit OTP (`/agent/auth/claim` → `/agent/auth/claim/complete`), which binds and verifies their real email to the account in place. Adds two-hop discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server` with the `agent_auth` block, `/auth.md`) and a `WWW-Authenticate` bootstrap header on 401s. The issued credential is a least-privilege `abu_` management session (never an agent identity, never `access.*`); the agent manages the person's credentials through the normal `items`/`profiles` surface including personal-account owner-reveal. Claim tokens and OTPs are hashed, single-use/bounded, and TTL'd; claim-email-in-use is rejected; expired unclaimed accounts are GC'd. New `account_claims` table (migration `0027`).
- 5946d0e: Remove the orphaned `0022_agents_rls_exemption.sql` migration — a byte-identical duplicate of the journaled `0025_agents_rls_exemption.sql`, left behind by the #175/#180 migration-numbering collision and never listed in `_journal.json` — and correct the `init.ts` comment that cited the stale `0022` number. Hygiene only: `drizzle-kit migrate` already ignored the non-journal file, so no applied migration changes. This does **not** by itself unblock the `Run Production Migrations` CI job; that job is blocked by `0022_backfill_guard` correctly refusing to advance until the §AB-0003 server-managed item backfill runs against production (an operational step).
- 7a08963: Re-route the profiles and organizations tRPC routers through the `scopedDb` org choke-point so tenant-table access carries its org filter again. A stale-base merge in #180 reverted the AB-0010 scoped-DAL routing in both routers, which (a) re-introduced the direct tenant-table imports the import-ban ratchet forbids and (b) made a cross-org `profiles.bootstrap` return `FORBIDDEN` instead of `NOT_FOUND`, reopening a cross-org existence oracle. The fix keeps #180's `scopedSessionProcedure` / `app.current_org` GUC wiring and restores the scoped queries on top of it (defense in depth: app-layer org filter + RLS backstop).
- a8f6d65: CI hygiene: the release workflow (`release.yml`) now uses a shared `.github/actions/setup` composite action that pins Bun, restores the Bun install cache (keyed on `bun.lock`), and installs with a frozen lockfile, instead of an inline toolchain + cold install. No change to the released CLI/MCP binaries or their build commands; this only affects how the release pipeline provisions its toolchain.
- 7187b66: Docs: remove remaining library-specific terms ("Better Auth") from SECURITY.md, specs/API.md, specs/CLI.md, and DEVELOPMENT.md. Documentation-only change; no runtime behavior changes.
- a1e744f: Docs: remove library-specific terms ("Better Auth") from API, CLI, and MCP documentation. Replace with implementation-neutral language that describes feature behavior rather than the underlying library. Documentation-only change; no runtime behavior changes.
- 846d585: Schema cleanup: drop two dead objects. `items.content_nonce` was never written or read by application code (the ZK content nonce is prepended into `ciphertext`) (AB-0041), and the legacy singular `audit_log` table — superseded by `audit_logs` — was defined and exported but referenced by nothing (AB-0023). Migration `0017` drops both; the Drizzle schema no longer declares them. No behavior change.
- 2c27c33: Branded React Email templates for the verification and password-reset emails,
  plus a dedicated transactional sender (`no-reply@notifications.abadge.io`,
  overridable via `ABADGE_EMAIL_FROM` / `ABADGE_EMAIL_FROM_NAME`). Server-side
  email rendering only — no CLI/MCP behavior change; patch to satisfy the
  release-surface dependency closure (cli/mcp depend on `@abadge/auth`).
- 9fe260f: Mark CLI and MCP entry points as executable.
- a24c0f0: Add the least-privilege application database role policy (AB-0012). `scripts/least-privilege.sql` provisions `app_runtime` — a `NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB` role with DML-only access and `UPDATE`/`DELETE`/`TRUNCATE` revoked on `audit_logs`, closing the TRUNCATE gap the `0018` immutability trigger cannot (TRUNCATE bypasses row-level triggers) and keeping the AB-0011 RLS backstop enforceable. An integration test proves the policy against an ephemeral role, and a runbook documents PlanetScale provisioning + connection cutover. The role is provisioned out-of-band by the database owner; this PR adds no runtime behavior change.
- f1fc1db: Add cursor (keyset) pagination to the items, agents, and permissions list endpoints (AB-0050). Each accepts optional `cursor`/`limit` (server-bounded at 100) and returns `nextCursor`, ordered by `(createdAt DESC, id DESC)` so pages are stable and non-overlapping under concurrent inserts. Backward compatible at the wire level: the existing array key on each result is unchanged.

  Because the new default page size (50) would otherwise silently truncate callers that expected the full list, the bundled SDK list helpers (`listItems`, `listAgents`, `listPermissions`) now transparently drain every page and return the complete set. This keeps the CLI `export`/`import`/`list` commands and SDK list-then-find helpers (`agents.get`, `permissions.get`) correct for orgs larger than one page; without it they would have seen only the first 50 rows.

- 82ec6ee: Add a structured-logging redaction guard (AB-0091). New `redactSecrets` helper masks secret-bearing keys (value/fields/payload/password/token/ciphertext/...) at every depth, and is wired into the audit-failure warning so a failed audit write can't surface a secret to Workers observability. A regression guard test captures all console output during an agent reveal and asserts the decrypted plaintext never appears — failing loudly if a future debug log prints a payload.
- 1040a58: Account/organization deletion (`organizations.delete`) no longer blocks when items exist. Deletion now cascades through items, profiles, agents, and permissions (audit logs are preserved) and is gated by two server-re-checked requirements: a typed-name confirmation (`confirmName` must equal the org's current name → `CONFIRMATION_MISMATCH`) and re-authentication of the caller's account password (`REAUTH_FAILED`, or `REAUTH_PASSWORD_REQUIRED` for password-less social-login accounts). The `SDK AbadgeUserClient.orgs.delete(orgId, { confirmName, password })` signature now requires the confirmation object. Every attempt (allowed or denied) is audit-logged. Removed the now-unused `ORG_NOT_EMPTY` error code.
- 6192549: Add a "Personal account" choice to onboarding. A personal account is a hidden personal organization — a normal single-member org flagged via `organization.metadata` (`{"type":"personal"}`) — so it reuses all org-scoping, middleware, and audit paths with no schema migration. A new `organizations.createPersonal` procedure (no input) auto-generates a name/slug and seeds one default `server_managed` profile; `organizations.create`/`list`/`get` now carry an `isPersonal` flag. Personal accounts hold one profile by default (more allowed), can register many agents, and coexist with team orgs the user creates or joins later (rides on the existing `X-Abadge-Org-Id` resolution, so no agent-facing behavior changes).
- 32d62e8: Cap personal accounts at a single profile. `profiles.create` now rejects an additional profile on a personal organization (flagged via `organization.metadata`) with a new `PROFILE_LIMIT_EXCEEDED` (409) error; the cap check and the insert run in one transaction with a per-org advisory lock so concurrent creates cannot race past it. The cap is "at most one" — an existence check, not a blanket block — so an admin who deletes the seeded default profile can recreate exactly one. Team organizations remain uncapped. The CLI's `profile add` surfaces the new error hint, and the dashboard hides the create-profile affordance for personal accounts. No schema migration.
- c1efb83: Add personal user API keys (`abu_`) and remove the legacy agent API key method.

  **Personal API keys** — a long-lived credential bound to a (user, org) pair that authenticates the management API only. It resolves to a session identity, so it can never reach the agent-gated `access.*` surface (no secret reveal/mount). New `user_api_keys` table, `apiKeys.{create,list,revoke}` tRPC procedures, `POST/GET /v1/api-keys` + `DELETE /v1/api-keys/{keyId}` REST routes, and a dashboard Settings "API keys" section. `AbadgeUserClient` accepts an `abu_` key as its bearer token.

  **Legacy agent API keys removed** — `legacy_api_key` (the `abl_`/`abg_` keys) is fully removed; agents now authenticate only via `public_key_session` (Ed25519 keypair → short-lived `abs_` sessions). Removed: the `agents.secretHash`/`secretPrefix` columns, agent API-key rotation (`agents.rotate`), the `apiKey`/`keyPrefix` fields, the `ABADGE_AUTH_TOKEN` env var, and the `AbadgeAgentApiKeyConfig` SDK config. Existing `legacy_api_key` agents lose their auth path (migration `0026`).

- 3af564a: Add integration coverage for `organizations.create` / `createPersonal` under the
  restricted NOBYPASSRLS role, and document the FORCE-RLS deploy-ordering hazard in
  the least-privilege runbook. Test/docs only — patch to satisfy the
  release-surface dependency closure (cli/mcp depend on `@abadge/trpc`).
- 1fcc266: Sign release binaries and publish a CycloneDX SBOM (AB-0102). Each GitHub release now attaches, per binary, a keyless cosign signature bundle (`*.cosign.bundle`) and a CycloneDX SBOM of the dependency closure alongside the existing `SHA256SUMS`. Signing runs under GitHub OIDC (Fulcio/Rekor) and the release fails if signing fails. Verify a download with `cosign verify-blob --bundle <artifact>.cosign.bundle --certificate-identity 'https://github.com/punitarani/abadge/.github/workflows/release.yml@refs/heads/main' --certificate-oidc-issuer https://token.actions.githubusercontent.com <artifact>`.
- 9bfeb6f: Add the per-profile server-managed DEK crypto primitives (AB-0030 crypto core): `generateServerDek`, `wrapServerDek`, and `unwrapServerDek` in `@abadge/crypto/server`, with golden-vector tests pinning the v3 wire format defined in `docs/ENVELOPE_SPEC.md`. The wrap AES-256-GCM-encrypts a 32-byte profile DEK under the master `ENCRYPTION_KEY`, AAD-bound to `(orgId, profileId)` so a wrapped DEK cannot be transplanted between profiles; v3 item content encrypts under the DEK via the existing key-agnostic `serverEncrypt`. No behavior change yet — the primitives are wired into the item create/decrypt paths in a follow-up PR. Bundled into the CLI/MCP binaries.
- 05c16b8: Wire the per-profile DEK envelope into server-managed items (AB-0030 implementation). New server-managed writes now encrypt content under a per-profile DEK (v3) instead of directly under the master `ENCRYPTION_KEY`; the DEK is provisioned on a profile's first v3 write and wrapped by the master key. All decrypt paths (owner reveal, agent reveal/read, mount pipeline) branch on `serverKeyVersion` via a single `server-envelope` helper, so existing v1/v2 rows decrypt unchanged. This narrows a master-key disclosure's blast radius to a single profile and makes `ENCRYPTION_KEY` rotation a per-profile DEK rewrap with zero content re-encryption. Adds the `profiles.server_wrapped_dek` column (migration).
- 9c35b9b: Bind server-managed items to a profile at create time (AB-0001) so profile-level grants cover them and the AES-GCM AAD is profile-scoped instead of using the no-profile sentinel. `item.create` now resolves the org's default `server_managed` profile, and also accepts an optional explicit `profileId` on both storage modes (AB-0002), validating org ownership and storage-mode match. Pre-existing NULL-profile rows continue to decrypt unchanged.
- 7ef4d51: Supply-chain hardening. Raise dependency floors above known-CVE thresholds — `hono >=4.10.2` (CVE-2025-62610), `@trpc/server >=11.8.0` (CVE-2025-68130), `effect >=3.20.0` (CVE-2026-32887) (AB-0103); align Better Auth to a single `1.5.6` across the workspace, matching the existing override (AB-0100); and add a report-only CI dependency-audit job (AB-0101). Resolved versions are unchanged (the lockfile already floated above the floors and the vulnerable features are unused) — this prevents a future install from resolving into vulnerable ranges.

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
