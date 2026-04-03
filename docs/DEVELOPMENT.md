# Development Guide

## Prerequisites

* [Bun](https://bun.sh/) 1.3+
* [Docker](https://docs.docker.com/get-docker/) for local Postgres
* [Doppler CLI](https://docs.doppler.com/docs/install-cli)
* Node.js 22+ for some local tooling

## Setup

```bash
git clone https://github.com/punitarani/abadge.git
cd abadge
bun install
```

## Environment

Root commands that need runtime secrets go through Doppler.

```bash
doppler setup
```

Required variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | `postgresql://abadge:abadge@localhost:5432/abadge` |
| `ABADGE_API_URL` | Public API origin and Better Auth base URL | `http://localhost:8787` |
| `ABADGE_APP_URL` | Public web origin | `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | Better Auth secret | random string |
| `ENCRYPTION_KEY` | AES-256-GCM key for server-managed items | `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` | Google OAuth client id | from Google OAuth app |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | from Google OAuth app |
| `GITHUB_CLIENT_ID` | GitHub OAuth client id | from GitHub OAuth app |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | from GitHub OAuth app |

`bun run dev` regenerates `apps/api/.dev.vars` and `apps/web/.env.local` from Doppler before
starting local Worker dev. Before writing `apps/api/.dev.vars`, the script validates that every
secret declared in `apps/api/wrangler.jsonc` `secrets.required` is present in Doppler, so local dev
fails fast on missing API Worker secrets. The canonical URL inputs are `ABADGE_API_URL` and
`ABADGE_APP_URL`; the web client still accepts `NEXT_PUBLIC_*` as a legacy fallback.

Production deploys also run through Doppler. Each Worker deploy script syncs the secrets declared
in that Worker's `wrangler.jsonc` `secrets.required` list from the active Doppler environment
before the code deploy, so Doppler remains the source of truth for deploy-time values.

```bash
cd apps/api && doppler run -- bun run deploy
cd apps/web && doppler run -- bun run deploy
```

## Database

```bash
docker compose up -d
bun run db:push
```

`bun run db:migrate` expects `DATABASE_URL` to be present in the active Doppler config. If you are
running migrations directly against local Docker Postgres without Doppler, use:

```bash
DATABASE_URL=postgresql://abadge:abadge@localhost:5432/abadge \
  bun --cwd packages/db run db:migrate
```

## Local development

```bash
bun run dev
```

This starts:

* API worker on `:8787`
* web app on `:3000`

In local web development, TanStack Query Devtools are mounted automatically in development mode for
React Query inspection. They are not rendered in production builds.

Useful worker-only commands:

```bash
bun run dev:vars
bun run api:dev:worker
bun run api:clean:worker
```

## Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install dependencies |
| `bun run dev` | Start the API worker and web app |
| `bun run build` | Build all packages |
| `bun run typecheck` | TypeScript check all workspaces |
| `bun run lint` | Run Biome checks |
| `bun run lint:fix` | Apply Biome fixes |
| `bun run format` | Format repo files |
| `bun run db:push` | Push schema to the database |
| `bun run db:generate` | Generate migrations |
| `bun run db:migrate` | Run pending migrations |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run db:reset` | Reset the schema locally |
| `bun run cli -- --help` | Run the CLI |
| `bun run mcp` | Start the MCP server |
| `bun test` | Run tests |

## Releasing `@abadge/sdk`

SDK publishing is isolated to `.github/workflows/publish-sdk.yml`. It does not use Doppler or
`DOPPLER_TOKEN`; npm publishing is authenticated through GitHub Actions OIDC trusted publishing.

Before the first release, configure npm trusted publishing for package `@abadge/sdk` to trust this
repository and the exact workflow file `.github/workflows/publish-sdk.yml`.

Release flow:

```bash
# 1. Bump packages/sdk/package.json version and merge that change to main

# 2. Create a matching release tag from main
git tag sdk-v0.1.0
git push origin sdk-v0.1.0
```

The workflow only runs for tags matching `sdk-vX.Y.Z`. It verifies that the tag version matches
`packages/sdk/package.json` and that the tagged commit is reachable from `origin/main` before
publishing `@abadge/sdk` to npm.

## Package structure

```text
packages/core    -> Effect Schema contracts, constants, tagged errors
packages/crypto  -> encryption and API-key helpers
packages/db      -> Drizzle schema and DB client
packages/auth    -> Better Auth setup
packages/env     -> environment validation
packages/trpc    -> app router, clients, context, error mapping
packages/daemon  -> local vault daemon and JSON-RPC client
packages/broker  -> execution helpers for local secret use
packages/cli     -> CLI command implementations
packages/mcp     -> MCP server and tools
packages/sdk     -> public TypeScript client built on tRPC

apps/api         -> Hono worker shell + mounted tRPC transport
apps/web         -> Next.js dashboard
```

## Adding a new control-plane procedure

1. add or update Effect Schema contracts in `packages/core/src/schemas.ts`
2. add DB schema changes in `packages/db/src/schema/` if needed
3. implement the Effect program in the appropriate router under `packages/trpc/src/server/routers/`
4. expose the procedure from `packages/trpc/src/server/router.ts`
5. update consumers in web, SDK, CLI, MCP, or daemon helpers through the shared tRPC client
6. update `docs/API.md`

Do not add a parallel REST route.

## Adding a new CLI command

1. add a command in `packages/cli/src/commands/`
2. register it in `packages/cli/src/index.ts`
3. update `docs/CLI.md`

## Adding a new MCP tool

1. add the tool in `packages/mcp/src/tools/`
2. register it in `packages/mcp/src/server.ts`
3. update `docs/MCP.md`

## Testing and verification

Primary verification targets:

```bash
bun run typecheck
bun run lint
bun test
```

The repo currently relies on:

* Effect Schema decode/encode tests in `packages/core`
* crypto tests in `packages/crypto`
* Better Auth tests in `packages/auth`
* tRPC and consumer smoke coverage in the workspace test suite

## Working conventions

Keep these repo-level rules in mind:

* `packages/core` is contract-first and Effect-first
* `packages/trpc` is the only application transport
* use Drizzle instead of raw SQL unless the exception is justified inline
* keep decrypt paths behind explicit authorization checks
* update docs when behavior changes
