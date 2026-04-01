# AGENTS.md

## Purpose

This repo builds abadge: an agent credential firewall. Users store secrets, define access policies, and control how agents consume credentials -- with a full audit trail. Keep the codebase small, explicit, and security-first.

## Prime directives

1. Preserve the product model: users store secrets, register agents, grant access per credential with policies, approve sensitive requests, and inspect a full audit trail.
2. Preserve the system model: single Postgres source of truth, synchronous request/response flows, no background infrastructure for MVP.
3. Preserve the security model: encrypted credentials, hashed agent API keys, explicit permission checks, policy evaluation, delivery mode enforcement, immutable access logging.
4. Prefer deletion over abstraction and abstraction over duplication.
5. When docs and code disagree, code wins. Then fix the docs.

## Stack

* Bun
* Turborepo
* TypeScript strict mode
* Hono on Cloudflare Workers
* Next.js App Router via OpenNext
* Drizzle ORM
* PlanetScale Postgres via Hyperdrive
* Better Auth
* Zod
* Biome

## Repo map

```text
apps/
  api/      API worker (control plane)
  cli/      Distributable CLI binary (bun build --compile)
  web/      dashboard
packages/
  auth/     Better Auth setup (server + client)
  broker/   local execution engine (env inject, file mount, session management, connectors)
  cli/      CLI tool library (commands, config, output)
  config/   shared tsconfig
  core/     shared types, zod schemas, constants, error shapes
  db/       schema and db client
  env/      environment validation (server, client, worker)
  mcp/      MCP server for AI agents
  sdk/      TypeScript SDK (@abadge/sdk)
```

## What each layer owns

### apps/api

Owns:

* auth endpoints (Better Auth catch-all + social provider discovery)
* dashboard CRUD endpoints (credentials, agents, permissions, policies, approvals, connectors, auto-grants, agent groups)
* agent credential access endpoint with policy evaluation
* AES-256-GCM encryption/decryption of credential values and connector configs
* agent auth via API key hash lookup and broker session token verification
* permission enforcement (explicit grants + auto-grant fallback)
* policy evaluation (pure function, per-access)
* approval workflows (create on policy trigger, approve/deny by owner)
* broker session management (create, list, revoke)
* external connector secret fetching (HTTP connectors: Doppler, HashiCorp Vault, Infisical)
* audit log writes (append-only, every access attempt)
* rate limiting

Does not own:

* UI
* duplicated domain types already defined in `packages/core`
* long-running workflows

### apps/web

Owns:

* dashboard UI
* auth screens (email/password + social login)
* forms and navigation
* rendering one-time agent keys
* policy and approval management views
* audit views

Does not own:

* authorization policy
* encryption logic
* database access that bypasses API contracts unless explicitly designed that way

### packages/core

Owns:

* shared domain types (Credential, Agent, Permission, Policy, Approval, BrokerSession, Connector, AutoGrant, AgentGroup, AccessLogEntry, etc.)
* zod schemas (CreateCredentialSchema, CreateAgentSchema, GrantPermissionSchema, AgentAccessRequestSchema, CreatePolicySchema, CreateSessionSchema, CreateConnectorSchema, CreateAutoGrantSchema, CreateAgentGroupSchema, etc.)
* constants (credential types, delivery modes, environments, sensitivities, principal types, access outcomes, approval statuses, connector types, social providers, session statuses)
* shared error shapes and error codes

### packages/db

Owns:

* schema (credentials, apikey, agent\_credential\_permissions, policies, approvals, broker\_sessions, connectors, auto\_grants, agent\_groups, agent\_group\_members, access\_log, auth tables, organization)
* indexes (unique constraint on user+credential name, access log indexes on credential+timestamp and agent+timestamp)
* database client factory
* migrations config

### packages/auth

Owns:

* Better Auth server/client wiring
* Social provider detection (Google, GitHub)
* Trusted origin configuration

### packages/env

Owns:

* environment variable validation schemas (server, client, worker)
* shared env access helpers

### packages/broker

Owns:

* API client for abadge control plane
* subprocess secret injection (`abadge run` -- env var injection)
* temp file mounting (`abadge mount` -- 0600 permissions, auto-cleanup)
* broker session lifecycle
* connector interface and implementations (native, 1Password, AWS)

Does not own:

* policy evaluation (that's in the API)
* audit log storage (that's in the API)
* UI

### packages/cli

Owns:

* command parsing and routing (login, whoami, secret, grant, run, mount, audit, approve, connector)
* user config (~/.abadge/config.json)
* terminal output formatting
* interactive login flow

Does not own:

* secret execution (delegates to broker)
* policy decisions (delegates to API)

### packages/mcp

Owns:

* MCP server setup and tool registration
* tool-specific input/output schemas
* tools: list\_available\_credentials, request\_secret\_use, run\_with\_secret, fill\_login, mount\_secret\_file, request\_approval, get\_secret\_metadata, get\_audit\_context
* policy-aware tool descriptions

Does not own:

* secret execution (delegates to broker)
* raw secret exposure to LLM (by design)

### packages/sdk

Owns:

* TypeScript API client (@abadge/sdk)
* typed error classes (UnauthorizedError, ForbiddenError, NotFoundError, ApprovalRequiredError)
* client-side schemas and types

Does not own:

* server-side logic
* CLI or MCP concerns

## Non-negotiable invariants

* No plaintext credential storage.
* No plaintext API key storage.
* No plaintext session token storage.
* No credential read without an explicit agent-credential grant or matching auto-grant.
* No cross-user credential access.
* Every allowed and denied agent read must be logged.
* No wildcard permissions for v1.
* No Durable Objects, Queues, Workflows, or background jobs unless the product requirements changed.
* No raw SQL unless Drizzle cannot express the query and the reason is documented inline.
* Default delivery mode is NOT reveal (agent access defaults to env\_inject).
* LLM agents should not receive raw secrets by default.
* Every delivery mode change must be audited.
* Broker sessions must have TTL (max 24 hours for v1).
* Connector configs must be encrypted at rest.
* Audit log is append-only with no foreign key constraints.
* Policy evaluation must be a pure function with no side effects.

## Data model summary

* `user` owns `credentials` (encrypted values, unique name per user)
* `user` owns `agents` (Better Auth API keys, hashed, prefix `abg_`)
* `agent_credential_permissions` is the explicit grant table (composite PK on agent+credential, optional policy attachment, delivery mode constraints, expiration)
* `auto_grants` define pattern-matching rules that grant agents automatic access to matching credentials
* `policies` define access rules (delivery mode, environment, sensitivity, destination, TTL)
* `approvals` track pending access requests (24h TTL, approve/deny by credential owner)
* `broker_sessions` provide short-lived scoped access tokens (prefix `abs_`, max 24h TTL)
* `connectors` configure external vault integrations (configs encrypted at rest)
* `agent_groups` organize agents into named collections
* `access_log` is append-only (includes delivery mode, outcome, session tracking, no FK constraints)

## Main flows to protect

### Credential create/update

* validate input with Zod schema
* encrypt value with AES-256-GCM using random 12-byte IV
* store ciphertext + IV only (base64-encoded)
* never return encrypted value or IV in responses

### Agent registration

* create via Better Auth API key system
* key is SHA-256 hashed before storage
* store hash + prefix (`abg_`)
* show full key once, never retrievable again

### Agent credential access

* authenticate bearer token (session token first by `abs_` prefix, then API key)
* resolve agent
* resolve credential for same user
* check explicit permission or matching auto-grant
* check permission expiration
* evaluate attached policy (if any)
* check delivery mode constraints (credential x permission x policy intersection)
* if policy requires approval, check for existing valid approval or create new one
* decrypt only for value-returning delivery modes (reveal, env\_inject, file\_mount)
* for external credentials, fetch from connector instead of decrypting
* append audit event for every outcome (allowed, denied, pending\_approval)

### Local broker injection

* CLI/MCP requests secret access
* broker gets authorized access from API
* injects into subprocess env or temp file
* secret never persisted to disk long-term
* LLM never sees raw secret

### Broker session flow

* agent authenticates with API key
* creates short-lived session (TTL, scoped to credentials and delivery modes)
* session token (prefix `abs_`) used for subsequent requests
* session expires or is revoked

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

* validate all external input with Zod
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
* keep flows obvious: credentials, agents, permissions, policies, approvals, audit
* show the one-time API key clearly and warn that it will not be shown again
* do not reimplement backend policy in the client

## What not to introduce casually

* event buses
* service layers that just forward calls
* alternate auth systems
* alternate RPC stacks
* ORM bypasses
* premature caching layers
* generic plugin systems unrelated to the documented product
* end-to-end encryption infrastructure without product requirements
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
* **Security model change** (new auth method, changed encryption, new policy rule type) -> update `docs/SECURITY.md`
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
| `docs/SECURITY.md` | Security reviewers and integrators | Encryption, auth, authorization, audit, delivery modes |
| `docs/DEVELOPMENT.md` | New contributors | Setup, commands, package structure, how to add features |

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
