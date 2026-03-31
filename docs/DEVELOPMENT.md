# Development Guide

## Prerequisites

* [Bun](https://bun.sh/) 1.3+
* [Docker](https://docs.docker.com/get-docker/) (for local Postgres)
* [Doppler CLI](https://docs.doppler.com/docs/install-cli)
* Node.js 22+ (for MCP typecheck)

## Setup

```bash
git clone https://github.com/punitarani/abadge.git
cd abadge
bun install
```

### Environment

Root commands that need application secrets now run through Doppler. Configure the repo once:

```bash
doppler setup
```

Required variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | `postgresql://abadge:abadge@localhost:5432/abadge` |
| `BETTER_AUTH_URL` | API base URL | `http://localhost:8787` |
| `BETTER_AUTH_SECRET` | Auth signing secret | Any random string |
| `ENCRYPTION_KEY` | AES-256-GCM key (base64) | `openssl rand -base64 32` |
| `NEXT_PUBLIC_API_URL` | API URL for browser | `http://localhost:8787` |

`.env.example` remains the reference for the values you should store in Doppler. If you bypass the
root scripts and run a package directly, provide the same environment variables manually.

### Database

```bash
docker compose up -d      # Start Postgres
bun run db:push           # Apply schema
```

### Dev servers

```bash
bun run dev               # Starts API (8787) + Web (3000)
```

## Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install dependencies |
| `bun run dev` | Start all dev servers |
| `bun run build` | Build all packages |
| `bun run typecheck` | TypeScript check all packages |
| `bun run lint` | Biome lint |
| `bun run lint:fix` | Biome lint with auto-fix |
| `bun run format` | Biome format |
| `bun run db:generate` | Generate migration from schema changes |
| `bun run db:push` | Push schema to database (no migration) |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run cli -- --help` | Run CLI |
| `bun run mcp` | Start MCP server |

## Package structure

```
packages/core    → shared types, schemas, constants (no runtime deps)
packages/db      → Drizzle schema + client (depends on core)
packages/auth    → Better Auth config (depends on db)
packages/env     → t3-env validation (no internal deps)
packages/broker  → execution engine (no internal deps)
packages/cli     → CLI tool (no internal deps)
packages/mcp     → MCP server (depends on @modelcontextprotocol/sdk)

apps/api         → Hono worker (depends on core, db, auth)
apps/web         → Next.js dashboard (depends on core, auth, env)
```

Build order: `config → core → env → db → auth → api/web` (Turborepo handles this).

## Adding a new API route

1. Add Zod schema to `packages/core/src/schemas.ts`
2. Add DB table (if needed) to `packages/db/src/schema/`, export from `index.ts`
3. Create route file in `apps/api/src/routes/`
4. Register in `apps/api/src/index.ts`
5. Update `docs/API.md`

## Adding a new CLI command

1. Create command file in `packages/cli/src/commands/`
2. Register in `packages/cli/src/index.ts`
3. Update `docs/CLI.md`

## Adding a new MCP tool

1. Create tool file in `packages/mcp/src/tools/`
2. Register in `packages/mcp/src/server.ts`
3. Update `docs/MCP.md`

## Database migrations

Schema changes go in `packages/db/src/schema/`. For production:

```bash
bun run db:generate    # Creates migration SQL in packages/db/migrations/
bun run db:push        # For dev: push directly without migration
```

## Linting and formatting

Uses [Biome](https://biomejs.dev/) 2.x:

* 2-space indent, 100-char line width, double quotes
* `process.env` banned outside `packages/env` (use `@abadge/env` instead)
* `noNonNullAssertion: error`, `noExplicitAny: warn`

## Testing

No test framework configured yet. Current testing approach:

* `bun run typecheck` — type safety across all packages
* `bun run lint` — code quality
* API e2e — curl against running dev server
* Browser e2e — Playwright against running dev + web servers
