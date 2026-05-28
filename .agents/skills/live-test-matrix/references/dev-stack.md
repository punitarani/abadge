# Dev stack

How to bring up the full stack for live testing.

## The command

```bash
doppler run -- turbo dev --filter='!@abadge/docs' &
```

The `--filter='!@abadge/docs'` is **required**. The docs app uses Mintlify which needs the `mint` CLI installed globally. Most devs don't have it, and `bun run dev` will fail with `mint: command not found` at exit 127 if you don't filter docs out.

## Expected ports and processes

| Service | URL | Tech | Started by |
|---|---|---|---|
| API | http://localhost:8787 | Hono on wrangler dev (Cloudflare Worker emulator) | `apps/api` |
| Web | http://localhost:3000 | Next.js (turbopack) | `apps/web` |
| Postgres | localhost:5432 | host-native install (NOT docker) | external |

The Postgres lives outside the dev stack — it's a Mac-installed Postgres at `localhost:5432` with creds `abadge:abadge` against the `abadge` database. Verify with:

```bash
psql postgresql://abadge:abadge@localhost:5432/abadge -c "SELECT 1"
```

If that fails, the test infrastructure also supports running Postgres in docker via `bun run docker:up`. The integration tests use `localhost:5432/abadge_test` (separate DB, same instance).

## Wait for ready

```bash
until curl -s http://localhost:8787/health 2>/dev/null | grep -q "ok"; do sleep 3; done
echo "API ready"
```

`:8787/health` returns `{"status":"ok"}` when the API is fully booted. Web takes a moment longer but the matrix usually doesn't hit the web — the API is what you need.

## Common errors

### `mint: command not found`

You forgot the `--filter='!@abadge/docs'`. Add it.

### `Organization onboarding is not complete`

Per the AGENTS.md `Onboarding-complete gate` invariant, any `scopedSessionProcedure` or `agentProcedure` call requires the org to have at least one bootstrapped profile. Create a profile via `profiles.create` (with `storageMode: "server_managed"` for the simplest setup) before exercising other endpoints.

### `X-Abadge-Org-Id header required for multi-org users`

Once the test user has 2+ orgs, every `sessionProcedure` call needs the `X-Abadge-Org-Id` header. Set it on every request, or pre-emptively keep the user single-org for the early phase of the matrix and only create a 2nd org for the cross-org pentest at the very end.

### Rate limit (`RATE_LIMITED`, 100 req/min)

The middleware allows 100 requests per minute per org. A full ~30-scenario matrix sits near the edge; if the tally shows late-stage cascading failures, add `sleep 60` between phases or split into multiple harnesses.

## Stopping

Always stop in a teardown step:

```bash
pkill -f "turbo dev" 2>&1
pkill -f "wrangler dev" 2>&1
pkill -f "next dev" 2>&1
```

`scripts/teardown.sh` does this.
