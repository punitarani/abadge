# AGENTS.md

## Purpose

This repo builds abadge: an agent credential firewall. Users store secrets in encrypted vaults, register agent principals, grant per-item capabilities, and control how agents consume secrets -- with a full audit trail and zero-knowledge encryption. Keep the codebase small, explicit, and security-first.

## Prime directives

1. Preserve the product model: users store secrets in vaults, register agent principals, grant per-item capabilities, and inspect a full audit trail.
2. Preserve the system model: single Postgres source of truth, synchronous request/response flows, no background infrastructure for MVP.
3. Preserve the security model: zero-knowledge vault encryption (client-side), server-managed encryption (AES-256-GCM), hashed legacy agent API keys, short-lived agent session tokens (prefix `abs_`), explicit grant checks, capability enforcement, immutable audit logging.
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
* REST routes: vault, items, agents, permissions, access, audit
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
* rendering one-time agent API keys
* vault security page (password change, recovery key, key rotation)

Does not own:

* authorization logic
* encryption logic
* database access that bypasses API contracts

### packages/core

Owns:

* shared domain types (ItemPayload, Agent, Permission, AuditEntry, Vault, etc.)
* Effect Schema schemas (CreateItemSchema, CreateAgentSchema, CreatePermissionSchema, CiphertextAccessSchema, RevealAccessSchema, MountAccessSchema, AuditQuerySchema, VaultBootstrapSchema, etc.)
* constants (ITEM_KINDS, STORAGE_MODES, AGENT_KINDS, AGENT_LOCALITIES, PRINCIPAL_AUTH_METHODS, CAPABILITIES, AUDIT_EVENT_TYPES, AUDIT_RESULTS, token prefixes and TTLs)
* error shapes (BadRequestError, ValidationError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, RateLimitError)

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

* tRPC router: auth, vault, items, agents, permissions, access, audit
* middleware: session procedure (user auth), agent procedure (agent auth)
* Effect integration for resolving session/agent identity
* server-side encryption/decryption dispatch (ZK passthrough vs server-managed AES-GCM)
* grant/capability enforcement
* audit log writes (append-only, every access attempt)
* request context creation (DB, auth, env validation)

Does not own:

* HTTP routing (that's in `apps/api`)
* client-side crypto (that's in `packages/crypto`)

### packages/db

Owns:

* schema (vaults, items, principals, grants, auditLog, agentSessions, agentSessionChallenges, agentEnrollmentTokens, auth tables, organization tables)
* indexes (vaults: unique user\_id; items: user\_id, vault\_id; grants: unique principal+item+capability; audit\_log: user\_id, principal\_id, item\_id, occurred\_at; agent\_sessions: token\_hash, agent\_id, user\_id, expires\_at)
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

* grant/capability checks (that's in the API/tRPC layer)
* audit log storage (that's in the API/tRPC layer)
* UI

### packages/cli

Owns:

* command parsing and routing (login, vault, item, agent, permission, run, mount, audit, daemon)
* user config (~/.abadge/config.json)
* terminal output formatting
* interactive login flow (device code)

Does not own:

* secret execution (delegates to daemon)
* grant decisions (delegates to API)

### packages/mcp

Owns:

* MCP server setup and tool registration (stdio transport)
* tools: list\_items, request\_access, run\_with\_secret, mount\_secret, get\_audit
* daemon client integration for local decryption
* API client for remote access

Does not own:

* secret execution (delegates to daemon)
* raw secret exposure to LLM (by design)

### packages/sdk

Owns:

* TypeScript API client (@abadge/sdk, class AbadgeClient)
* tRPC client wrapper for Node.js
* typed error class (AbadgeApiError with statusCode + code)
* public API surface covering vault, items, agents, permissions, access, audit

Does not own:

* server-side logic
* CLI or MCP concerns

## Non-negotiable invariants

* No plaintext secret storage. ZK items use client-side XChaCha20-Poly1305; server\_managed items use AES-256-GCM.
* No plaintext API key storage. Keys are SHA-256 hashed; only the prefix is stored for lookup.
* No plaintext session token storage. Agent session tokens are hashed before storage.
* No item access without an explicit grant (principal + item + capability).
* No cross-user item access. Items and principals are scoped to their owning user.
* Every allowed and denied agent access attempt must be logged in audit\_log.
* No wildcard grants for v1. Each grant is (principal, item, capability).
* No Durable Objects, Queues, Workflows, or background jobs unless the product requirements changed.
* No raw SQL unless Drizzle cannot express the query and the reason is documented inline.
* Audit log is append-only with no foreign key constraints.
* The server never sees root keys or plaintext for zero\_knowledge items. KDF and unwrapping happen client-side only (browser, CLI, daemon).
* Daemon socket must be 0600. Mounted secret files must be 0600.
* Agent session tokens have a 15-minute default TTL. Bootstrap tokens expire in 10 minutes. Challenges expire in 60 seconds.

## Data model summary

* `vaults` — one per user. Stores wrappedRootKey, kdfSalt, kdfParams (Argon2id), recoveryWrappedRootKey, keyVersion. Unique index on userId.
* `items` — secrets. Two storage modes: `zero_knowledge` (encryptedItemKey, keyNonce, ciphertext, contentNonce) and `server_managed` (serverCiphertext, serverIv, serverKeyVersion). Supports optimistic concurrency via contentVersion. Soft-delete via deletedAt.
* `principals` — agents/devices. Fields: kind (device, local\_cli, local\_mcp, remote\_agent), locality (local, remote), authMethod (public\_key\_session, legacy\_api\_key), secretHash, secretPrefix, publicKey, enabled, revokedAt, metadata.
* `grants` — explicit capability grants. Composite unique index on (principalId, itemId, capability). Optional expiresAt. References grantedBy user.
* `auditLog` — append-only. Fields: userId, principalId, itemId, eventType, result (allowed/denied/expired/revoked), deliveryMode, meta (JSONB), ipAddress, occurredAt. No FK constraints.
* `agentEnrollmentTokens` — one-time bootstrap tokens for remote public-key agents. Hashed token, expiresAt (10 min), usedAt.
* `agentSessionChallenges` — short-lived signed challenge material for session exchange. Hashed challenge, expiresAt (60s), usedAt.
* `agentSessions` — short-lived access tokens (prefix `abs_`). Hashed token, expiresAt (15 min default), revokedAt, lastUsedAt.
* `organization`, `member`, `invitation` — org structure (Better Auth).
* `user`, `session`, `account`, `verification`, `deviceCode` — auth tables (Better Auth).

## Main flows to protect

### Item create (zero\_knowledge)

* validate input with Effect Schema (CreateItemSchema)
* client derives KEK from password via Argon2id, unwraps root key
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
* default authMethod: legacy\_api\_key produces an API key (shown once, SHA-256 hash stored)
* public\_key\_session agents may provide a publicKey at creation or enroll later via bootstrap token
* bootstrap tokens (prefix `abe_`) issued for unenrolled remote public-key agents, 10-minute TTL

### Agent session exchange (public\_key\_session)

* agent requests challenge (prefix `abc_`, 60s TTL)
* agent signs challenge with Ed25519 private key
* API verifies signature against stored public key
* API issues session token (prefix `abs_`, 15-minute TTL)

### Agent item access

* authenticate bearer token: try agent session (by `abs_` prefix) first, then legacy API key hash lookup
* resolve principal, verify enabled and not revoked
* resolve item for same user, verify not deleted
* check for matching grant (principalId + itemId + requested capability)
* check grant expiration
* for `read_ciphertext`: return encrypted blob (local agents only, ZK items only)
* for `reveal_plaintext`: server decrypts server\_managed item, returns plaintext
* for `mount_env` / `mount_file`: return data appropriate for local injection
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
```

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

Documentation lives in `docs/` and must stay accurate with the code.

### When to update docs

* **New API route** -> update `docs/API.md` with method, path, auth, request/response schema
* **Changed API route** (new field, changed behavior, removed endpoint) -> update `docs/API.md`
* **New CLI command or changed flags** -> update `docs/CLI.md`
* **New MCP tool or changed tool behavior** -> update `docs/MCP.md`
* **Architecture change** (new package, new system boundary, changed trust model) -> update `docs/ARCHITECTURE.md`
* **Security model change** (new auth method, changed encryption, new grant type) -> update `docs/SECURITY.md`
* **New dev setup step or changed command** -> update `docs/DEVELOPMENT.md`
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
| `docs/ARCHITECTURE.md` | Devs and agents | System design, entity model, trust boundaries, request flows |
| `docs/API.md` | API consumers (CLI, SDK, integrations) | Every endpoint with method, path, auth, request/response |
| `docs/CLI.md` | Developers using the CLI | Command reference with examples |
| `docs/MCP.md` | AI agent integrators | MCP tool reference and security model |
| `docs/SECURITY.md` | Security reviewers and integrators | Encryption, auth, authorization, audit, capabilities |
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
