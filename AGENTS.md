# AGENTS.md

## Purpose

This repo builds abadge: an agent credential firewall. Users store secrets, define access policies, and control how agents consume credentials — with a full audit trail. Keep the codebase small, explicit, and security-first.

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
  web/      dashboard
packages/
  auth/     Better Auth setup
  broker/   local execution engine (env inject, file mount, session management)
  cli/      CLI tool (`abadge` command)
  config/   shared tsconfig
  core/     shared types, zod schemas, constants
  db/       schema and db client
  env/      environment validation
  mcp/      MCP server for AI agents
```

## What each layer owns

### apps/api

Owns:

* auth endpoints
* dashboard CRUD endpoints
* agent access endpoint
* encryption/decryption
* agent auth
* permission enforcement
* policy evaluation
* approval workflows
* broker session management
* audit log writes

Does not own:

* UI
* duplicated domain types already defined in `packages/core`
* long-running workflows

### apps/web

Owns:

* dashboard UI
* auth screens
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

* shared domain types
* zod schemas
* constants
* shared error shapes

### packages/db

Owns:

* schema
* indexes
* database client factory
* migrations config

### packages/auth

Owns:

* Better Auth server/client wiring

### packages/env

Owns:

* environment variable validation schemas
* shared env access helpers

### packages/broker

Owns:

* API client for abadge control plane
* subprocess secret injection (`abadge run`)
* temp file mounting (`abadge mount`)
* broker session lifecycle
* connector interface and implementations (native, 1Password, AWS)

Does not own:

* policy evaluation (that's in the API)
* audit log storage (that's in the API)
* UI

### packages/cli

Owns:

* command parsing and routing
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
* policy-aware tool descriptions

Does not own:

* secret execution (delegates to broker)
* raw secret exposure to LLM (by design)

## Non-negotiable invariants

* No plaintext credential storage.
* No plaintext API key storage.
* No credential read without an explicit agent-credential grant.
* No cross-user credential access.
* Every allowed and denied agent read must be logged.
* No wildcard permissions for v1.
* No Durable Objects, Queues, Workflows, or background jobs unless the product requirements changed.
* No raw SQL unless Drizzle cannot express the query and the reason is documented inline.
* Default delivery mode is NOT reveal.
* LLM agents should not receive raw secrets by default.
* Every delivery mode change must be audited.
* Broker sessions must have TTL (max 24 hours for v1).
* Connector configs must be encrypted at rest.

## Data model summary

* `user` owns `credentials`
* `user` owns `agents` (apikeys)
* `agent_credential_permissions` is the grant table (with policy attachment)
* `policies` define access rules per credential
* `approvals` track pending access requests
* `broker_sessions` provide short-lived scoped access tokens
* `connectors` configure external vault integrations
* `access_log` is append-only (includes delivery mode, outcome, session tracking)

## Main flows to protect

### Credential create/update

* validate input
* encrypt value in API
* store ciphertext + IV only

### Agent registration

* generate random key
* hash key
* store hash + prefix
* show full key once

### Agent credential access

* authenticate bearer token
* resolve agent
* resolve credential for same user
* verify explicit permission
* decrypt only after authorization
* append audit event for allow/deny

### Policy-aware access

* authenticate (session token or API key)
* resolve credential
* verify permission
* evaluate attached policies
* if approval required, create approval and return 202
* enforce delivery mode constraints
* decrypt only if deliveryMode is "reveal"
* log comprehensive audit event

### Broker session flow

* agent authenticates with API key
* creates short-lived session (TTL, scoped)
* session token used for subsequent requests
* session expires or is revoked

### Local broker injection

* CLI/MCP requests secret access
* broker gets authorized access from API
* injects into subprocess env or temp file
* secret never persisted to disk long-term
* LLM never sees raw secret

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
