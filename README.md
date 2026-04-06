# abadge

**Credential control plane for AI agents.**

abadge lets teams store native encrypted credentials or connect existing secret systems, permission
agents explicit access only when needed, enforce policy and approval checks at runtime, and audit
every access attempt across the dashboard, API, CLI, SDK, and MCP server.

## What it does

* Stores native credentials as encrypted entries
* References external secrets through connectors
* Registers agents with unique API keys
* Per-credential permissions for each agent
* Evaluates policy and approval requirements at request time
* Issues short-lived broker sessions for runtime access
* Records allowed, denied, and pending approval access events
* Exposes the same control plane through the dashboard, API, CLI, SDK, and MCP

## Why it exists

Agents need credentials. Operators need control.

abadge sits between them:

* users keep ownership of credentials
* agents only use what they were explicitly allowed
* policy and approval rules are enforced before use
* every access attempt is visible and attributable

## Product wedge

For v1, abadge should be understood as:

* **Access** -- explicit permissions, policy checks, approvals, sessions, and audit
* **Connect** -- native encrypted storage plus external secret references
* **Interfaces** -- dashboard, CLI, SDK, MCP, and the control-plane tRPC API

It is not positioned as a generic human password manager.

## Product scope

### Included in v1

* Native credential CRUD
* Agent registry
* Per-credential permissions
* Policies and approvals
* Connector support
* Short-lived broker sessions
* Immutable access log
* Web dashboard
* CLI, SDK, and MCP surfaces
* Organization support

### Not included in v1

* End-to-end zero-knowledge encryption
* Background workflows
* OAuth for agents
* Webhooks
* Browser extension

## Core model

Each credential is a named entry with:

* `type` — `api_key`, `login`, `token`, `json_blob`, `pii`, or `other`
* `value` — encrypted opaque string
* `metadata` — optional JSON annotations

Agents authenticate with a static API key issued once at registration or with a short-lived broker
session token. Keys and session tokens are hashed before storage. Every access request is checked
against explicit permissions, attached policy, delivery-mode constraints, and approval state before any
decryption occurs.

## How it works

1. A user signs in to the dashboard or CLI.
2. The user stores a native credential or configures an external reference.
3. The user registers one or more agents.
4. The user creates a permission for Agent X to access Credential Y and optionally attaches policy.
5. The agent calls the API with an API key or session token.
6. abadge verifies agent identity, ownership, permission, delivery mode, policy, and approval status.
7. If allowed, abadge resolves the secret only for the requested delivery mode.
8. abadge records the access attempt in the audit log.

## Architecture

* **API:** Hono on Cloudflare Workers
* **Dashboard:** Next.js App Router on Cloudflare Workers via OpenNext
* **Database:** Postgres (PlanetScale in production, Docker locally)
* **Connection layer:** Cloudflare Hyperdrive
* **ORM:** Drizzle
* **Auth:** Better Auth
* **Validation:** Zod
* **Monorepo:** Turborepo + Bun
* **Formatting/Linting:** Biome

## Repo layout

```text
apps/
  api/      Hono API worker
  web/      Next.js dashboard
packages/
  auth/     Better Auth config
  broker/   local execution helpers
  cli/      CLI commands, config, and compiled binary entrypoint
  config/   shared TS config
  core/     shared types, schemas, constants
  crypto/   encryption and API-key helpers
  daemon/   local vault daemon
  db/       Drizzle schema, client, and migrations
  env/      environment validation
  mcp/      MCP server and tools
  sdk/      TypeScript client
  trpc/     canonical application router and clients
```

## CLI install

The CLI ships as a Unix binary through GitHub Releases.

```bash
curl -fsSL https://raw.githubusercontent.com/punitarani/abadge/main/install.sh | bash
```

Release docs:

* [`docs/release/overview.md`](./docs/release/overview.md)
* [`docs/release/cli.md`](./docs/release/cli.md)

## Security principles

* AES-256-GCM encryption at rest for credential values and connector configs
* API keys and session tokens shown once, then stored only as hashes
* Explicit agent-to-credential access control
* Policy and approval checks before decryption
* Non-reveal delivery modes by default
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
bun run build         # Build all apps
bun run lint          # Check for lint errors
bun run lint:fix      # Auto-fix lint errors
bun run format        # Format code
bun run typecheck     # Type check all packages
bun run storybook     # Start Storybook for the web UI components
bun run storybook:build # Build the Storybook static site
bun run db:generate   # Generate migration from schema
bun run db:migrate    # Run pending migrations
bun run db:push       # Push schema directly to database
bun run db:studio     # Open Drizzle Studio
bun run db:reset      # Drop schema and re-run migrations
bun test              # Run the test suite
bun run docker:up     # Start Docker services
bun run docker:down   # Stop Docker services
bun run docker:reset  # Reset Docker volumes and restart
```

### Environment variables

Repository commands that need application secrets run through Doppler. After installing the CLI,
run `doppler setup` in the repo root. Doppler is the source of truth for local development;
`bun run dev` regenerates `apps/api/.dev.vars` for the Worker from the active Doppler config.

## Status

This repo is the implementation of the abadge MVP: a small, edge-deployed credential control plane
built for user-controlled agent access.
