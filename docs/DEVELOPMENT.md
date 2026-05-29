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
| `ABADGE_API_URL` | Public API base URL | `http://localhost:8787` |
| `ABADGE_APP_URL` | Public web origin | `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | Authentication secret | random string |
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

### Claude Code cloud sessions

[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) sessions run in a
fresh VM with no access to your local Doppler auth, so secrets come from a dedicated Doppler config
plus a committed SessionStart hook.

* **Doppler config `dev_agents`** — a branch config under the `dev` environment. It inherits all of
  `dev` except `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY`, which are regenerated so cloud agents never
  use the real `dev` session/encryption keys.
* **Cloud environment config** (set in the claude.ai/code environment UI, not the repo):
  * Network access **Full** — Doppler's API is not in the default allowlist.
  * Environment variables: a read-only Doppler service token scoped to `dev_agents`, as
    `DOPPLER_TOKEN`. No secret values live here.
  * Setup script: installs the Doppler CLI, runs `bun install`, and creates the local `abadge`
    Postgres role/db.
* **`.claude/settings.json` + `scripts/cloud/load-doppler-env.sh`** — a SessionStart hook that, in
  cloud sessions only (`CLAUDE_CODE_REMOTE=true`), downloads the `dev_agents` secrets into
  `$CLAUDE_ENV_FILE` so they are ambient for every command. It is a no-op in local sessions.

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

### Seeding demo data

With the stack running, `bun run seed` populates a ready-to-use demo tenant by
driving the real public API (the same path as the e2e golden-path test): it
creates a verified user, a personal org with its default profile, a
`server_managed` item, a legacy-API-key CLI agent and an Ed25519 keypair MCP
agent, and grants both `reveal_plaintext` on the item. It then prints every
credential needed to exercise the web UI, CLI (`--token-stdin`), API, and MCP
server.

```bash
bun run seed                      # defaults: dev@abadge.local / DevPassword123!
bun run seed -- --email me@x.dev  # override login (also --password, --name)
```

It reads `ABADGE_API_URL` (default `http://localhost:8787`) and `DATABASE_URL`
(default local Docker Postgres) from the environment — no Doppler required. The
only direct DB write flips `user.email_verified`, since local dev has no SMTP
and the authentication layer blocks sign-in until the address is verified. Re-running is
idempotent: the org, profile, item, and agents are reused (the CLI agent's
one-time API key is rotated each run); the MCP agent's private key is written to
`~/.abadge/seed-mcp-agent.key.json` (0600).

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
| `bun run seed` | Seed a demo tenant (user, org, item, agents, grants) against a running stack |
| `bun run db:generate` | Generate migrations |
| `bun run db:migrate` | Run pending migrations |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run db:reset` | Reset the schema locally |
| `bun run cli -- --help` | Run the CLI |
| `bun run mcp` | Start the MCP server |
| `bun test` | Run tests |
| `bun run test:cov:unit` | Unit tests with coverage (no DB) |
| `bun run test:cov:integration` | Integration tests with coverage (needs Postgres) |
| `bun run test:cov` | Both coverage buckets, sequentially |
| `bun run changeset` | Create a changeset |
| `bun run release:cli:dry-run` | Build CLI release artifacts locally |
| `bun run release:publish -- --dry-run --package cli` | Dry-run the generic release publisher |

## Package structure

```text
packages/core    -> Effect Schema contracts, constants, tagged errors
packages/crypto  -> encryption and API-key helpers
packages/db      -> Drizzle schema and DB client
packages/auth    -> Authentication setup
packages/env     -> environment validation
packages/trpc    -> app router, clients, context, error mapping
packages/daemon  -> local vault daemon, JSON-RPC client, and execution helpers
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

## Release model

Changesets live at the repo root in `/.changeset/`.

Releases are package-scoped, not repo-scoped. A package only becomes releasable when it is added to
[`scripts/releases/registry.ts`](../scripts/releases/registry.ts). Today that registry contains only
the CLI package.

Release docs:

* [`docs/release/overview.md`](./release/overview.md)
* [`docs/release/cli.md`](./release/cli.md)

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
* Auth tests in `packages/auth`
* tRPC and consumer smoke coverage in the workspace test suite

### Test buckets and coverage

Three buckets, classified in `scripts/coverage/buckets.ts`:

* **unit** — pure in-process, no DB or spawned services. Run with `bun run test:cov:unit`.
* **integration** — real Postgres (`TEST_DATABASE_URL`) or in-process spawned servers/sockets (`packages/trpc/src/server/__tests__/integration/**`, daemon socket tests, sdk client stub server). Run with `bun run test:cov:integration`.
* **e2e** — `apps/e2e` (boots `wrangler dev` + compiled CLI/MCP binaries). Run with `bun run test:e2e`. **No coverage report** — bun's coverage cannot instrument across the workerd / binary boundary; the integration bucket covers the same paths in-process.

`bun run test` (turbo) and `bun run test:e2e` remain the source of truth for "all tests pass." The `test:cov:*` commands are coverage-aware re-runs that write `lcov.info` to `coverage/<bucket>/`.

### End-to-end suite (apps/e2e)

`apps/e2e` boots a real `wrangler dev` API against the test Postgres and drives
it through three surfaces: the SDK over HTTP, the compiled `abadge` CLI binary
as a subprocess, and the MCP stdio server as a JSON-RPC peer. It is not part of
`bun run test` (it would race the trpc package's parallel test run on the same
database). Run it explicitly:

```bash
docker compose up -d   # or any local Postgres exposing :5432 with abadge_test
TEST_DATABASE_URL=postgresql://abadge:abadge@localhost:5432/abadge_test \
  bun run test:e2e
```

`turbo test:e2e` builds `@abadge/cli` and `@abadge/mcp` first so the tests
spawn the same compiled artifacts users run. Set `E2E_DEBUG=1` to forward the
spawned wrangler's stdout/stderr through the test runner for debugging.

## Working conventions

Keep these repo-level rules in mind:

* `packages/core` is contract-first and Effect-first
* `packages/trpc` is the only application transport
* use Drizzle instead of raw SQL unless the exception is justified inline
* keep decrypt paths behind explicit authorization checks
* update docs when behavior changes
