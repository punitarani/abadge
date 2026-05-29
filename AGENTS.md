# AGENTS.md

## Purpose

This repo builds abadge: an agent credential firewall. Users belong to organizations, store secrets in encrypted profiles, register agents, grant per-item capabilities, and control how agents consume secrets -- with a full audit trail and zero-knowledge encryption. Keep the codebase small, explicit, and security-first.

## Prime directives

1. Preserve the product model: users belong to organizations, store secrets in profiles, register agents, grant per-item capabilities, and inspect a full audit trail.
2. Preserve the system model: single Postgres source of truth, synchronous request/response flows, no background infrastructure for MVP.
3. Preserve the security model: zero-knowledge profile encryption (client-side), server-managed encryption (AES-256-GCM), short-lived agent session tokens (prefix `abs_`) as the sole agent auth method, hashed personal user API keys (prefix `abu_`) for the management surface only, explicit permission checks, capability enforcement, immutable audit logging.
4. Prefer deletion over abstraction and abstraction over duplication.
5. When docs and code disagree, code wins. Then fix the docs.

## Stack

* Bun
* Turborepo
* TypeScript strict mode
* Hono on Cloudflare Workers
* tRPC
* Next.js App Router via OpenNext
* Drizzle ORM
* PlanetScale Postgres via Hyperdrive
* Better Auth
* Effect Schema
* Biome

## Repo map

```text
apps/
  api/      API worker (Hono + tRPC on Cloudflare Workers)
  cli/      Distributable CLI binary (bun build --compile)
  e2e/      End-to-end tests (wrangler dev API + real CLI binary + real MCP stdio)
  web/      Dashboard (Next.js App Router)
packages/
  auth/     Better Auth setup (server + client)
  cli/      CLI tool library (commands, config, output)
  config/   shared tsconfig
  core/     shared types, Effect Schema schemas, constants, error shapes
  crypto/   cryptographic primitives (ZK vault, server-managed AES, API keys, Ed25519)
  daemon/   local vaultd process (root key custody, encrypt/decrypt, subprocess injection via Unix socket)
  db/       Drizzle schema and db client
  env/      environment validation (server, client, worker)
  mcp/      MCP server for AI agents
  sdk/      TypeScript SDK (@abadge/sdk)
  trpc/     tRPC router definitions, middleware, server-side handlers
```

## What each layer owns

### apps/api

Owns:

* Hono app with REST v1 routes and tRPC catch-all (`/trpc/*`)
* Better Auth catch-all route (`/api/auth/*`)
* tRPC routers: auth, organizations, profiles, items, agents, permissions, access, audit
* rate limiting middleware (auth: 60/min, tRPC/v1: 100/min)
* CORS via Better Auth trusted origins
* health check endpoint

Does not own:

* tRPC handler logic (lives in `packages/trpc`)
* UI
* duplicated domain types already defined in `packages/core`
* long-running workflows

### apps/web

Owns:

* dashboard UI (items, agents, permissions, audit, settings)
* auth screens (login, register)
* device code approval flow
* item create/edit forms
* agent registration forms
* rendering one-time secrets (agent bootstrap tokens; personal API keys in org Settings → "API keys")
* vault security page (password change, recovery key, key rotation)

Does not own:

* authorization logic
* encryption logic
* database access that bypasses API contracts

### packages/core

Owns:

* shared domain types (ItemPayload, Agent, Permission, AuditEntry, Profile, etc.)
* Effect Schema schemas (CreateItemSchema, CreateAgentSchema, CreatePermissionSchema, CiphertextAccessSchema, RevealAccessSchema, MountAccessSchema, AuditQuerySchema, VaultBootstrapSchema, etc.)
* constants (ITEM_KINDS, STORAGE_MODES, AGENT_KINDS, AGENT_LOCALITIES, AGENT_AUTH_METHODS, CAPABILITIES, AUDIT_EVENT_TYPES, AUDIT_RESULTS, STANDARD_FIELDS_BY_KIND, CAPABILITY_MATRIX, token prefixes and TTLs)
* error shapes (BadRequestError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, RateLimitError, FieldNotFoundError, MultiFieldItemError) — all carry `{ code, message, hint, meta }`
* field delivery helpers: `resolveFieldValue`, `expandFieldSelection`, `listStringFields` in `secret-delivery.ts`

### packages/crypto

Owns:

* client-side ZK crypto (@noble/ciphers, @noble/hashes): Argon2id KDF, XChaCha20-Poly1305 key wrapping, per-item DEK encrypt/decrypt, root key rotation (rekey)
* server-side crypto (WebCrypto): AES-256-GCM encrypt/decrypt for server\_managed items
* API key generation, SHA-256 hashing, constant-time verification
* Ed25519 key pair generation, signing, verification (WebCrypto)
* opaque token generation (bootstrap, challenge, session tokens)
* base64url and base32 encoding/decoding
* salt generation

### packages/trpc

Owns:

* tRPC router: auth, organizations, profiles, items, agents, permissions, access, audit
* middleware: session procedure (user auth), agent procedure (agent auth), `requireOrgRole()` RBAC middleware
* Effect integration for resolving session/agent identity
* server-side encryption/decryption dispatch (ZK passthrough vs server-managed AES-GCM)
* permission/capability enforcement
* cascade handlers: `onAgentRevoked()`, `onItemDeleted()`, `onMemberRemoved()`
* audit log writes (append-only, every access attempt)
* request context creation (DB, auth, env validation)

Does not own:

* HTTP routing (that's in `apps/api`)
* client-side crypto (that's in `packages/crypto`)

### packages/db

Owns:

* schema (profiles, items, agents, permissions, audit\_logs, userApiKeys, agentSessions, agentSessionChallenges, agentEnrollmentTokens, auth tables, organization tables)
* indexes (profiles: unique orgId+name; items: orgId, profileId; permissions: unique agentId+itemId+capability; audit\_logs: userId, agentId, itemId, occurredAt; agentSessions: tokenHash, agentId, userId, expiresAt)
* database client factory
* migrations config

### packages/auth

Owns:

* Better Auth server/client wiring
* Social provider detection (Google, GitHub)
* Device code flow
* Trusted origin configuration

### packages/env

Owns:

* environment variable validation schemas (server, client, worker)
* shared env access helpers

### packages/daemon

Owns:

* vaultd Unix domain socket IPC server (JSON-RPC 2.0 over newline-delimited messages)
* in-memory VaultState (root key custody, auto-lock timer, encrypt/decrypt/rekey operations)
* RPC methods: vault.unlock, vault.lock, vault.status, vault.changePassword, item.encrypt, item.decrypt, item.rekey, exec.env, exec.mount, exec.cleanup
* subprocess secret injection (exec.env: env var injection via Bun.spawn)
* temp file mounting (exec.mount: 0600 permissions, tracked for cleanup)
* process lifecycle (PID file, signal handling, socket permissions)

Does not own:

* permission/capability checks (that's in the API/tRPC layer)
* audit log storage (that's in the API/tRPC layer)
* UI

### packages/cli

Owns:

* command parsing and routing (login, logout, daemon, vault, item, agent, permission, run, mount, audit, org, profile, import, export)
* user config (~/.abadge/config.json): `apiUrl`, `activeOrgId`, `activeProfileId`
* terminal output formatting
* interactive login flow (device code); login does NOT auto-register an agent
* `--value` rejected on TTY (prevents shell history leaks; stdin pipe instead)
* error hints rendered from `AbadgeApiError.hint`

Does not own:

* secret execution (delegates to daemon)
* permission decisions (delegates to API)

### packages/mcp

Owns:

* MCP server setup and tool registration (stdio transport)
* tools: `list_items`, `run_with_secret`, `mount_secret`, `release_mount`, `get_audit`
* auth: keypair-backed only (`ABADGE_AGENT_ID` + `ABADGE_PRIVATE_KEY_PATH`)
* `run_with_secret`: spawns subprocess with secret in env; captures stdout/stderr (bounded to 8 KB per stream) but never forwards output text to the model — returns only exit code, duration, output-line count, and truncation flag (§RED1)
* `mount_secret`: returns opaque `mountId` (file path never returned to model); auto-cleanup after 5 min
* orphan cleanup on startup (removes `abadge-*` temp dirs older than 10 minutes)
* daemon client integration for local decryption of ZK items

Does not own:

* secret execution (delegates to daemon)
* raw secret exposure to LLM (by design)

### packages/sdk

Owns:

* TypeScript API client (@abadge/sdk): `AbadgeUserClient` (session auth), `AbadgeAgentClient` (agent auth)
* `AbadgeAgentClient`: keypair-backed Ed25519 session exchange with background T-2min refresh; `connect()` / `disconnect()` lifecycle; `field` parameter on `accessReveal` and `accessMount`
* `AbadgeUserClient`: management-surface client whose bearer is a Better Auth session token or a personal API key (`abu_`); org management (`createOrganization`, `listOrganizations`, etc.), profile management (`createProfile`, `listProfiles`, etc.). An `abu_` bearer cannot reach `access.*`.
* tRPC client wrapper for Node.js
* typed error class (`AbadgeApiError` with `statusCode`, `code`, `hint`, `meta`, `issues`)
* public API surface covering organizations, profiles, items, agents, permissions, access, audit

Does not own:

* server-side logic
* CLI or MCP concerns

## Non-negotiable invariants

* No plaintext secret storage. ZK items use client-side XChaCha20-Poly1305; server\_managed items use AES-256-GCM.
* No plaintext API key storage. Keys are SHA-256 hashed; only the prefix is stored for lookup.
* No plaintext session token storage. Agent session tokens are hashed before storage.
* Personal user API keys (`abu_`) authenticate the management surface only. They resolve to a session identity (`kind: "session"`), never an agent identity, and can never reach the agent-gated `access.*` surface — they cannot reveal or mount secret values. Reading secrets still requires a keypair agent plus an explicit permission. A personal API key cannot create or revoke other API keys.
* No item access without an explicit permission (agent + item + capability).
* No cross-org item access. Items and agents are scoped to their owning organization.
* Every allowed and denied agent access attempt must be logged in audit\_log.
* No wildcard permissions for v1. Each permission is (agent, item, capability).
* `permissions.create` is atomic per batch. Submitting multiple capabilities in one call writes either every row or none; partial grants are never observable. Matrix-violation and duplicate detection both pre-check and surface every offending capability via `meta.invalidCapabilities` / `meta.duplicateCapabilities`.
* No Durable Objects, Queues, Workflows, or background jobs unless the product requirements changed. **Documented exception:** `RateLimitCounter` (a single DO in `apps/api/src/durable-objects/`) backs the rate-limit middleware. Cross-isolate-consistent counters are a correctness requirement for rate limiting on Workers; no simpler primitive provides it. New DOs require the same threshold — a correctness/security necessity that cannot be met by Postgres or in-memory state.
* No raw SQL unless Drizzle cannot express the query and the reason is documented inline.
* Audit log is append-only with no foreign key constraints.
* The server never sees root keys or plaintext for zero\_knowledge items. KDF and unwrapping happen client-side only (browser, CLI, daemon).
* Daemon socket must be 0600. Mounted secret files must be 0600.
* Agent session tokens have a 15-minute default TTL. Bootstrap tokens expire in 10 minutes. Challenges expire in 60 seconds.
* `AbadgeAgentClient` keypair-backed sessions auto-refresh at T-2 minutes before expiry; no long-lived secret is stored on disk.
* Error envelopes use `{ code, message, hint, meta? }` — all four fields on every domain error.
* The `field` parameter on `access.reveal` and `access.mount` is resolved by `resolveFieldValue` in `@abadge/core/secret-delivery`; never duplicated in routers.
* **Org creation auto-seeds a usable profile.** `organizations.create` inserts the org, the owner `member` row, and a default `server_managed` profile in one transaction, so a freshly created org is immediately usable. There is no onboarding-completeness gate: `scopedSessionProcedure` and `agentProcedure` require org membership but do NOT require a bootstrapped profile (the at-use/at-issuance gate was removed in §REVAMP-PR3 Task 5.2). An org is "unbootstrapped" only if an admin deletes every profile, which is itself audit-logged; individual access procedures surface that as a domain error rather than a blanket middleware reject.

## Data model summary

* `organization` — org-scoped isolation boundary (Better Auth table). Users create a personal account, create an organization, or join one through the onboarding flow (`/onboarding`, `/join`, or org-switcher); signup does not auto-create an org. A personal account is a normal org flagged `metadata = {"type":"personal"}` (no dedicated column); the only differences are presentation (labelled "Personal") and one-click creation. Agents and permissions are scoped to an org.
* `profiles` — encryption boundaries within an org. Fields: orgId, name, storageMode (zero\_knowledge or server\_managed), wrappedRootKey, kdfSalt, kdfParams, recoveryWrappedRootKey, keyVersion. One profile can hold many items.
* `items` — secrets stored within a profile. Two storage modes: `zero_knowledge` (encryptedItemKey, ciphertext, contentNonce) and `server_managed` (serverCiphertext, serverIv, serverKeyVersion). Supports optimistic concurrency via contentVersion. Soft-delete via deletedAt. Note: `encryptedItemKey` carries the XChaCha20-Poly1305 key-wrap nonce prepended in its first 24 bytes; there is no separate `keyNonce` column.
* `agents` — service accounts scoped to an org. Fields: orgId, createdBy (nullable; `ON DELETE SET NULL` — deleting the creating user orphans the agent rather than deleting it, §AB-0043), kind (local\_cli, local\_mcp, remote), locality (local, remote), authMethod (effectively single-valued: `public_key_session`), publicKey, enabled, revokedAt, metadata. Agents authenticate only via Ed25519 keypair → `abs_` session tokens.
* `user_api_keys` — personal API keys (prefix `abu_`) for the management surface, bound to a (user, org) pair. Fields: id, userId (FK user, `ON DELETE cascade`), organizationId (FK organization, `ON DELETE cascade`), name, secretHash, secretPrefix, enabled, revokedAt, expiresAt, lastUsedAt, metadata, createdAt. RLS-exempt like `agents`. Resolves to a session identity; never reaches `access.*`.
* `permissions` — explicit capability grants. Fields: agentId, itemId, capability (read\_ciphertext, reveal\_plaintext, mount\_env, mount\_file), expiresAt, grantedBy (nullable; `ON DELETE SET NULL` so a grant outlives its granter, §AB-0043). Composite unique index on (agentId, itemId, capability).
* `audit_logs` — append-only. Fields: userId (nullable — an orphaned agent's actions log with a null actor-user, §AB-0043), agentId, itemId, eventType, result (allowed/denied/expired/revoked/cascade), deliveryMode, meta (JSONB), ipAddress, occurredAt. No FK constraints.
* `agentEnrollmentTokens` — one-time bootstrap tokens for public-key agents. Hashed token, expiresAt (10 min), usedAt.
* `agentSessionChallenges` — short-lived signed challenge material for session exchange. Hashed challenge, expiresAt (60s), usedAt.
* `agentSessions` — short-lived access tokens (prefix `abs_`). Hashed token, expiresAt (15 min default), revokedAt, lastUsedAt.
* `member`, `invitation` — org membership (Better Auth).
* `user`, `session`, `account`, `verification`, `deviceCode` — auth tables (Better Auth).

## Main flows to protect

### Onboarding (first login)

* signup redirects the user to `/onboarding`; no org (personal or otherwise) is auto-created
* `/onboarding` presents three options:
  * **Personal account** — a one-click action (no name/slug form). `organizations.createPersonal` (no input) auto-generates a workspace name/slug from the user row and transactionally seeds a *personal* org — flagged via `organization.metadata = {"type":"personal"}` (see `PERSONAL_ORG_METADATA` / `isPersonalOrg` in `@abadge/core`) — plus the owner `member` row and a default `server_managed` profile (name and `externalId` both `"default"`). A personal account is presented in the UI as a personal account rather than an organization, but is structurally a normal single-member org: it can hold many agents, the user can add more profiles later, and the user can still create or join team orgs later (coexistence rides on the existing `X-Abadge-Org-Id` resolution). Profile-count is the default of one, not a hard cap. **A personal account is NOT in custody mode.** Because the owner owns every secret, the dashboard frames it as the user's own vault: the overview posture banner, profiles subtitle, and settings copy drop the "on behalf of your users" / "under your custody" framing (centralized in `apps/web/src/lib/workspace-posture.ts`, keyed off `isPersonal` from `organizations.list`/`get` via the `useActiveOrg` hook), member management is hidden in Settings, and the owner can reveal their own item values from the item page (server-managed via `items.ownerReveal`, zero-knowledge via in-browser decrypt). Team organizations stay in custody mode — the dashboard never reveals plaintext there.
  * **Create a new organization** — a single step (`CreateOrgForm`). `organizations.create` transactionally inserts the org row, the owner `member` row, **and a default `server_managed` profile** (name and `externalId` both `"default"`) so the org is usable with no separate profile-bootstrap step. On success the user lands at `/overview`. Additional profiles — including `zero_knowledge` profiles with their own password — are added later from the profiles page (`profiles.create`, plus `profiles.bootstrap` for ZK).
  * **Join with an invite code** — paste a raw invite token (`abi_…`) or a full invite URL; the form calls `organizations.members.getInviteInfo` to preview, then `organizations.members.acceptInvite` on confirmation
* the shared `InviteAcceptForm` component also backs `/join?token=…` (manual-paste route) and the dashboard org-switcher "Join another organization…" dialog — one entry point should never diverge from the others
* on success, the zustand `useOrgStore.setActiveOrg` is populated so the dashboard layout renders without a stale-org round trip
* the resume-triage on mount (`decideResumeAction`): redirects to `/overview` whenever the user has any org (PR3's auto-seeded default profile makes every normally-created org immediately usable); falls through to the **Choose** screen only when the user has no orgs at all. An admin who has deleted the default profile recovers from the profiles page, not from onboarding.
* `organizations.list`/`get` carry an `isPersonal` boolean (derived from `organization.metadata` via `isPersonalOrg`) so the dashboard can label a personal workspace as "Personal" rather than "Organization".
* `createPersonalOrgForUser` in `packages/auth/src/personal-org.ts` is retained for tests and explicit admin seeding only; it is NOT wired to any Better Auth hook. It and the user-facing `organizations.createPersonal` share the `seedOrgWithOwnerProfile` builder (also in `personal-org.ts`) and both stamp the personal metadata flag + seed a default `server_managed` profile, so created orgs are immediately usable. `organizations.create` (team orgs) seeds the same default profile but no personal flag.

### Item create (zero\_knowledge)

* validate input with Effect Schema (CreateItemSchema)
* client derives KEK from password via Argon2id, unwraps profile root key
* client generates random 32-byte per-item DEK
* client encrypts payload with DEK (XChaCha20-Poly1305), wraps DEK with root key (XChaCha20-Poly1305)
* client sends encryptedItemKey + ciphertext to API
* API stores ciphertext — never sees plaintext or root key

### Item create (server\_managed)

* validate input with Effect Schema (CreateItemSchema)
* client sends plaintext payload to API
* API encrypts with AES-256-GCM using ENCRYPTION\_KEY and random 12-byte IV
* API stores serverCiphertext + serverIv + serverKeyVersion

### Agent registration

* validate with Effect Schema (CreateAgentSchema)
* authMethod is always `public_key_session`
* agents must provide `publicKey` or `issueBootstrapToken: true`
* bootstrap tokens (prefix `abe_`) issued for unenrolled public-key agents, 10-minute TTL

### Agent session exchange (public\_key\_session)

* agent requests challenge (prefix `abc_`, 60s TTL)
* agent signs challenge with Ed25519 private key
* API verifies signature against stored public key
* API issues session token (prefix `abs_`, 15-minute TTL)
* `AbadgeAgentClient` schedules background refresh at T-2 minutes before expiry

### Agent item access

* authenticate bearer token: resolve the agent session by `abs_` prefix (hash lookup, TTL check)
* resolve agent, verify enabled and not revoked
* resolve item for same org, verify not deleted
* check for matching permission (agentId + itemId + requested capability)
* check permission expiration
* for `read_ciphertext`: return encrypted blob (local agents only, ZK items only)
* for `reveal_plaintext`: server decrypts server\_managed item, returns field value via `resolveFieldValue`
* for `mount_env` / `mount_file`: return data appropriate for local injection; field resolved by `resolveFieldValue`
* append audit event for every outcome (allowed, denied, expired, revoked)

### Local daemon injection

* CLI/MCP sends `item.decrypt` RPC to daemon (Unix socket)
* daemon holds root key in memory, decrypts item DEK, decrypts payload
* CLI/MCP sends `exec.env` or `exec.mount` RPC
* daemon injects secret into subprocess env or writes temp file (0600)
* secret never persisted to disk long-term
* daemon auto-locks after 15 minutes of inactivity

## Working rules

### Before changing anything

* read the surrounding module end to end
* find the owning layer for the change
* verify whether the logic already exists elsewhere
* remove duplication instead of adding another path

### When making changes

* keep files short
* keep boundaries obvious
* prefer pure helpers for shared logic
* keep validation near boundaries
* use existing shared types/schemas first
* make illegal states hard to represent

### After making changes

* run formatting
* run lint
* run typecheck
* run affected tests if present
* review for duplicated logic and dead code
* update docs if behavior or architecture changed

## Commands

```bash
bun install
bun run dev
bun run build
bun run lint
bun run lint:fix
bun run format
bun run typecheck
bun run db:push
bun run cli -- --help        # Run CLI
bun run mcp                   # Start MCP server
bun test                      # Run test suite
bun run test:cov:unit         # Unit tests with coverage (no DB)
bun run test:cov:integration  # Integration tests with coverage (Postgres)
bun run test:e2e              # E2E (no coverage by design)
```

Test buckets are defined in `scripts/coverage/buckets.ts` (single source of truth: unit / integration / e2e). When adding a new test, place it where its dependencies fit: pure in-process tests are unit; tests that hit Postgres or spawn in-process servers are integration; tests that run against the compiled binaries via wrangler-dev belong in `apps/e2e`.

## Style rules

* TypeScript strict; no `any` unless unavoidable and justified
* Prefer explicit return types on exported functions
* Prefer small composable functions over large classes
* Prefer simple objects and functions over framework-heavy patterns
* Prefer one obvious path for each feature
* Avoid magic strings when a shared constant or schema already exists
* Avoid comments that restate code; keep comments for intent, invariants, and edge cases

## API rules

* validate all external input with Effect Schema
* keep auth and permission checks at the route boundary or dedicated middleware
* never return encrypted fields unnecessarily
* never decrypt unless the request is authorized
* denied access should still be logged

## DB rules

* schema changes belong in `packages/db`
* keep naming consistent with the existing domain language
* add indexes for real query patterns, not hypothetical ones
* optimize for correctness first, then simplicity, then performance

## Web rules

* treat the dashboard as an operator surface, not marketing pages
* keep flows obvious: items, agents, permissions, audit, settings
* show the one-time API key clearly and warn that it will not be shown again
* do not reimplement backend authorization in the client

## What not to introduce casually

* event buses
* service layers that just forward calls
* alternate auth systems
* alternate RPC stacks
* ORM bypasses
* premature caching layers
* generic plugin systems unrelated to the documented product
* key management services or HSM integration
* background job infrastructure

## Documentation rules

Internal contributor docs live in `docs/`. The public documentation site lives in `apps/docs/` (Mintlify). Both must stay accurate with the code; when they disagree, `docs/*.md` is the source of truth and `apps/docs/` follows.

### When to update docs

* **New API route** -> update `docs/API.md` with method, path, auth, request/response schema, then mirror in `apps/docs/api/procedures/*.mdx`
* **Changed API route** (new field, changed behavior, removed endpoint) -> update `docs/API.md` and the corresponding `apps/docs/api/procedures/*.mdx`
* **New CLI command or changed flags** -> update `docs/CLI.md` and `apps/docs/cli/*.mdx`
* **New MCP tool or changed tool behavior** -> update `docs/MCP.md` and `apps/docs/mcp/tools/*.mdx`
* **New dashboard page or changed flow** -> update `apps/docs/dashboard/*.mdx`
* **Architecture change** (new package, new system boundary, changed trust model) -> update `docs/ARCHITECTURE.md` and `apps/docs/architecture.mdx`
* **Security model change** (new auth method, changed encryption, new permission type) -> update `docs/SECURITY.md` and `apps/docs/security/*.mdx`
* **New dev setup step or changed command** -> update `docs/DEVELOPMENT.md` (internal only; not on Mintlify)
* **Changed invariant or working rule** -> update this file (`AGENTS.md`)

### How to update docs

* Keep docs terse and factual -- no marketing language, no aspirational features
* Document what IS, not what WILL BE
* If a feature is removed, remove it from docs -- do not leave stale references
* API docs use tables for request fields: `| Field | Type | Required | Description |`
* Test your docs by reading them as if you know nothing about the codebase

### Doc inventory

| File | Audience | Purpose |
|------|----------|---------|
| `AGENTS.md` | Devs and AI agents working in the repo | Product model, invariants, working rules, code conventions |
| `apps/docs/` | External integrators, operators, agent builders | Public Mintlify documentation site (Company, App, API, CLI, MCP). User-facing reference: when content here disagrees with `docs/*.md`, the `docs/*.md` source wins, then update Mintlify. |
| `docs/ARCHITECTURE.md` | Devs and agents | System design, entity model, trust boundaries, request flows |
| `docs/API.md` | API consumers (CLI, SDK, integrations) | Every endpoint with method, path, auth, request/response |
| `docs/CLI.md` | Developers using the CLI | Command reference with examples |
| `docs/MCP.md` | AI agent integrators | MCP tool reference and security model |
| `docs/SECURITY.md` | Security reviewers and integrators | Encryption, auth, authorization, audit, capabilities |
| `docs/FIELDS.md` | API consumers | Field delivery model, standard fields by item kind |
| `docs/ERRORS.md` | API consumers and SDK users | All error codes with HTTP status, description, and SDK handling |
| `docs/DEVELOPMENT.md` | New contributors | Setup, commands, package structure, how to add features |
| `docs/CI.md` | Maintainers | CI behavior and optional tooling (e.g. Turborepo remote cache env) |

## Expected review posture

Be harsh.

Flag:

* duplicate logic
* leaky abstractions
* dead code
* security regressions
* hidden coupling
* vague naming
* extra infrastructure without a direct MVP need

## If you are unsure

Default to the smallest change that preserves these invariants:

* one database
* explicit grants
* decrypt only on authorized read
* log every attempt
* keep the repo understandable in one pass
