# abadge

**One password for agents.**

abadge is a lightweight credential vault for the agentic era. Users store secrets once, grant explicit per-agent access, and get a full audit trail for every read.

## What it does

* Stores credentials as encrypted named entries
* Registers agents with unique API keys
* Grants access per credential, per agent
* Serves secrets to authorized agents at runtime
* Records every allowed and denied access
* Provides a web dashboard for credentials, agents, permissions, and audit history
* Supports organizations for multi-tenant access control

## Why it exists

Agents need credentials. Users need control.

abadge sits between them:

* users keep ownership of secrets
* agents only read what they were explicitly granted
* every access is visible and attributable

## Product scope

### Included in v1

* Credential CRUD
* Agent registry (via Better Auth API key plugin)
* Per-credential allowlists
* Immutable access log
* Web dashboard
* Agent-facing REST API
* Organization support
* OpenAPI documentation

### Not included in v1

* Secret rotation policies
* External integrations
* OAuth for agents
* Webhooks
* Browser extension

## Core model

Each credential is a named entry with:

* `type` — `api_key`, `login`, `token`, `json_blob`, `pii`, or `other`
* `value` — encrypted opaque string
* `metadata` — optional JSON annotations

Agents authenticate with a static API key issued once at registration. The key is hashed and stored by Better Auth's API key plugin. Every read is checked against a per-credential ACL.

## How it works

1. A user signs in to the dashboard.
2. The user stores credentials encrypted at rest.
3. The user registers one or more agents.
4. The user grants Agent X access to Credential Y.
5. The agent calls the API with its bearer token.
6. abadge verifies agent identity, ownership, and permission.
7. If allowed, abadge decrypts the credential and returns it.
8. abadge records the access attempt in the audit log.

## Architecture

* **API:** Hono on Cloudflare Workers
* **Dashboard:** Next.js App Router on Cloudflare Workers via OpenNext
* **Database:** Postgres (PlanetScale in production, Docker locally)
* **Connection layer:** Cloudflare Hyperdrive
* **ORM:** Drizzle
* **Auth:** Better Auth (organization, API key, OpenAPI plugins)
* **Validation:** Zod
* **Env:** t3-env for type-safe environment variables
* **Monorepo:** Turborepo + Bun
* **Formatting/Linting:** Biome

## Repo layout

```text
apps/
  api/    Hono API worker
  web/    Next.js dashboard
packages/
  auth/   Better Auth config (org, API key, OpenAPI plugins)
  config/ shared TS config
  core/   shared types, schemas, constants
  db/     Drizzle schema, client, and migrations
  env/    t3-env type-safe environment variables
```

## Security principles

* AES-256-GCM encryption at rest
* API keys shown once, hashed by Better Auth
* Per-credential access control
* Append-only audit logging
* Session auth for dashboard users
* Bearer auth for agents
* Drizzle parameterized queries
* Secure headers and rate limiting
* CSRF protection via Better Auth

## Development

### Prerequisites

* [Bun](https://bun.sh) >= 1.2
* [Docker](https://docker.com)
* [Doppler CLI](https://docs.doppler.com/docs/install-cli)

### Quick start

```bash
# Install dependencies
bun install

# Start local Postgres
bun run docker:up

# Configure Doppler for this repo
doppler setup

# Push schema to database
bun run db:push

# Start dev servers
bun run dev
```

### Common commands

```bash
bun run dev           # Start all dev servers
bun run dev:vars      # Generate apps/api/.dev.vars from Doppler
bun run build         # Build all apps
bun run lint          # Check for lint errors
bun run lint:fix      # Auto-fix lint errors
bun run format        # Format code
bun run typecheck     # Type check all packages
bun run db:generate   # Generate migration from schema
bun run db:migrate    # Run pending migrations
bun run db:push       # Push schema directly to database
bun run db:studio     # Open Drizzle Studio
bun run db:reset      # Drop schema and re-run migrations
bun run api:dev:worker  # Run the API in local wrangler mode
bun run api:clean:worker # Remove local wrangler state
bun test              # Run the test suite
bun run docker:up     # Start Docker services
bun run docker:down   # Stop Docker services
bun run docker:reset  # Reset Docker volumes and restart
```

### Environment variables

Repository commands that need application secrets run through Doppler. After installing the CLI,
run `doppler setup` in the repo root. `.env.example` remains the reference for which values need
to exist in Doppler.

For local Worker-only API development, `bun run dev:vars` writes `apps/api/.dev.vars` from the
current Doppler session, and `bun run api:dev:worker` starts `wrangler dev --local` with those
bindings.

## Status

This repo is the implementation of the abadge MVP: a minimal, edge-deployed secret vault built for user-controlled agent access. All core flows are tested end-to-end (53/53 tests passing).
