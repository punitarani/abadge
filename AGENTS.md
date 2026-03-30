# AGENTS.md

## Purpose

This repo builds abadge: a minimal credential vault for user-controlled agent access. Keep the codebase small, explicit, and security-first.

## Prime directives

1. Preserve the product model: users store secrets, register agents, grant access per credential, and inspect a full audit trail.
2. Preserve the system model: single Postgres source of truth, synchronous request/response flows, no background infrastructure for MVP.
3. Preserve the security model: encrypted credentials, hashed agent API keys, explicit permission checks, immutable access logging.
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
  api/   API worker
  web/   dashboard
packages/
  auth/  Better Auth setup
  config/ shared tsconfig
  core/  shared types, zod schemas, constants
  db/    schema and db client
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

## Non-negotiable invariants

* No plaintext credential storage.
* No plaintext API key storage.
* No credential read without an explicit agent-credential grant.
* No cross-user credential access.
* Every allowed and denied agent read must be logged.
* No wildcard permissions for v1.
* No Durable Objects, Queues, Workflows, or background jobs unless the product requirements changed.
* No raw SQL unless Drizzle cannot express the query and the reason is documented inline.

## Data model summary

* `user` owns `credentials`
* `user` owns `agents`
* `agent_credential_permissions` is the only grant table
* `access_log` is append-only

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
* keep flows obvious: credentials, agents, permissions, audit
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
