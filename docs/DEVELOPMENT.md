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

Root commands that need application secrets run through Doppler. Configure the repo once:

```bash
doppler setup
```

Required variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | `postgresql://abadge:abadge@localhost:5432/postgres` |
| `API_URL` | Public API origin used by Worker auth/CORS | `http://localhost:8787` |
| `APP_URL` | Public web origin used by Worker auth/CORS | `http://localhost:3000` |
| `BETTER_AUTH_URL` | API base URL for Better Auth | `http://localhost:8787` |
| `BETTER_AUTH_SECRET` | Auth signing secret | Any random string |
| `ENCRYPTION_KEY` | AES-256-GCM key for server-managed items (base64) | `openssl rand -base64 32` |
| `NEXT_PUBLIC_API_URL` | API URL for browser (optional when `ABADGE_API_URL` is set) | `http://localhost:8787` |
| `NEXT_PUBLIC_APP_URL` | App URL for browser (optional when `ABADGE_APP_URL` is set) | `http://localhost:3000` |

Optional social login variables:

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret |

Set both variables for a provider to enable that login option. Omit them entirely to keep
email/password auth only.

For web builds, `ABADGE_API_URL` and `ABADGE_APP_URL` are accepted as inputs and mapped to
`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL` during the Next/OpenNext build. This keeps the
public URLs out of Cloudflare Worker secret requirements for the web app.

Doppler is the source of truth for local development. `bun run dev` regenerates
`apps/api/.dev.vars` from the active Doppler config before starting `wrangler dev`, so the API
worker sees the same settings as the rest of the repo. Do not rely on a local `.env` file for
app runtime.

### Database

```bash
docker compose up -d      # Start Postgres
bun run db:push           # Apply schema
```

### Dev servers

```bash
bun run dev               # Starts API (8787) + Web (3000)
```

### API worker local files (Wrangler)

`wrangler dev` reads secrets from `apps/api/.dev.vars` (gitignored). To generate that file from
your Doppler `dev` config:

```bash
bun run dev:vars          # Writes apps/api/.dev.vars from Doppler env
```

To run only the API worker with Wrangler (after generating `.dev.vars`):

```bash
bun run api:dev:worker
```

Clear Wrangler's local state if local dev gets stuck:

```bash
bun run api:clean:worker
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
| `bun run dev:vars` | Generate `apps/api/.dev.vars` from Doppler |
| `bun run api:dev:worker` | Generate `.dev.vars` then `wrangler dev` for API only |
| `bun run api:clean:worker` | Remove `apps/api/.wrangler` cache |
| `bun run db:generate` | Generate migration from schema changes |
| `bun run db:migrate` | Run pending migrations |
| `bun run db:push` | Push schema to database (no migration) |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run db:reset` | Drop schema and re-run migrations |
| `bun run cli -- --help` | Run CLI |
| `bun run mcp` | Start MCP server |
| `bun test` | Run test suite |

## Package structure

```
packages/core    -> shared types, schemas, constants (no runtime deps)
packages/crypto  -> server-side encryption, API key generation, encoding
packages/db      -> Drizzle schema + client (depends on core)
packages/auth    -> Better Auth config (depends on db)
packages/env     -> t3-env validation (no internal deps)
packages/broker  -> execution engine (env inject, file mount, daemon IPC)
packages/cli     -> CLI tool library (commands, config, output)
packages/mcp     -> MCP server (depends on @modelcontextprotocol/sdk)
packages/sdk     -> TypeScript SDK (@abadge/sdk, depends on zod)

apps/api         -> Hono worker (depends on core, crypto, db, auth)
apps/cli         -> Distributable CLI binary (bun build --compile)
apps/web         -> Next.js dashboard (depends on core, auth, env)
```

Build order: `config -> core -> env -> crypto -> db -> auth -> api/web` (Turborepo handles this).

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

Tests use `bun test` (Bun's built-in test runner):

```bash
bun test
```

Test files:

| File | Covers |
|------|--------|
| `packages/crypto/src/__tests__/server-crypto.test.ts` | AES-256-GCM server encrypt/decrypt round-trips |
| `packages/crypto/src/__tests__/client-crypto.test.ts` | Client-side XChaCha20-Poly1305 encryption (ZK mode) |
| `packages/crypto/src/__tests__/api-keys.test.ts` | API key generation, hashing, verification |
| `packages/crypto/src/__tests__/encoding.test.ts` | Base64 encoding/decoding, random bytes |
| `packages/core/src/constants.test.ts` | Core constants and type validation |
| `packages/auth/src/server.test.ts` | Better Auth server configuration |

Additional verification:

* `bun run typecheck` -- type safety across all packages
* `bun run lint` -- code quality
* API e2e -- curl against running dev server
* Browser e2e -- Playwright against running dev + web servers

## SDK

The `@abadge/sdk` package (`packages/sdk/`) provides a typed TypeScript client for the abadge API.

```bash
cd packages/sdk
bun run build
```

Usage:

```typescript
import { AbadgeClient } from "@abadge/sdk";

const client = new AbadgeClient({
  apiUrl: "http://localhost:8787",
  token: "abg_your_api_key",
});

// Vault
const vault = await client.getVault();

// Items
const { items } = await client.listItems();
const item = await client.createItem({ storageMode: "server_managed", payload: { ... } });

// Principals
const { principals } = await client.listPrincipals();

// Grants
await client.createGrant({ principalId: "...", itemId: "...", capability: "reveal_plaintext" });

// Access
const { payload } = await client.accessReveal("item-id");

// Audit
const { entries } = await client.getAudit({ limit: 50 });
```

The SDK exposes methods for all API operations: vault management, items, principals, grants, access (ciphertext, reveal, mount), and audit log queries. Error handling uses `AbadgeApiError`.

## CLI binary

The `apps/cli/` directory builds a standalone CLI binary using Bun's compile feature:

```bash
cd apps/cli
bun run build    # produces dist/abadge
```

The compiled binary requires no runtime dependencies and can be distributed directly.
