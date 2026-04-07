# Testing Report: tRPC + Effect Refactor Hardening

**Date:** 2026-04-02  
**Workspace:** `/Users/punit/.codex/worktrees/4393/abadge`  
**Scope:** branch review, command verification, migration verification, manual QA, browser QA, and doc reconciliation

## Final status

Branch state is mechanically green after fixes.

Validated:

* `bun run format`
* `bun run lint:fix`
* `bun run lint`
* `bun run typecheck`
* `bun run build`
* `bun test`
* `bun run test`

Browser QA and scripted/manual QA also passed against local API and web dev servers.

## Verification results

| Check | Result | Notes |
|------|--------|-------|
| `bun run format` | PASS | Biome formatted repo successfully |
| `bun run lint:fix` | PASS | Clean after auth helper refactor |
| `bun run lint` | PASS | No remaining warnings |
| `bun run typecheck` | PASS | 14/14 workspaces successful |
| `bun run build` | PASS | Worker dry-run build and Next production build succeeded |
| `bun test` | PASS | 58 pass, 0 fail |
| `bun run test` | PASS | Workspace turbo test + worker env test successful |

## Migration verification

### Doppler state

| Check | Result | Notes |
|------|--------|-------|
| `doppler configure get project config --plain` | REVIEWED | Local scope is `amor / dev` |
| `doppler.yaml` | REVIEWED | Repo expects `abadge / dev` |
| Root `bun run db:migrate` | FAIL (environment) | Missing `DATABASE_URL` from local Doppler scope |

Conclusion:

* local Doppler is on the correct environment (`dev`) but the wrong project for this repo
* the branch itself is not blocking migrations; local secret sourcing is

### Direct migration check

Commands used:

```bash
docker compose up -d
DATABASE_URL=postgresql://abadge:abadge@localhost:5432/abadge \
  bun --cwd packages/db run db:migrate
```

Result:

* Drizzle migration command completed successfully
* Worker-facing database `abadge` contains the expected schema
* `drizzle.__drizzle_migrations` contains 4 applied migrations

Manual DB verification:

* confirmed worker local Hyperdrive target is `postgresql://abadge:abadge@localhost:5432/abadge`
* confirmed application tables exist in database `abadge`
* confirmed migration ledger is present and populated

## Manual QA

### API and SDK

Validated end-to-end via `AbadgeClient` against local API:

* user sign-up
* `vault.get` returns `VAULT_NOT_FOUND` before bootstrap
* `vault.setupRecovery` is rejected before bootstrap
* vault bootstrap, recovery setup, password change, and key rotation
* server-managed item create/list/get/update/delete
* zero-knowledge item create/list/get/update/delete
* stale item update returns `STALE_VERSION`
* agent create/list/get/rotate/revoke
* permission create/list/revoke
* remote agent locality restrictions
* local agent mount access
* remote reveal access
* rotated agent old secret rejection
* revoked permission rejection
* revoked agent rejection
* audit log entries for allowed and denied outcomes

### CLI and daemon

Validated with isolated home directory:

* `abadge login --api-url` with Better Auth device authorization
* config write to `~/.abadge/config.json`
* `abadge item list --json`
* `abadge agent list --json`
* `abadge permission list --json`
* `abadge audit --json`
* `abadge daemon start`
* `abadge daemon status`
* `abadge daemon stop`

## Browser QA

Browser QA was executed with Playwright against:

* API: `http://localhost:8787`
* Web: `http://localhost:3000`

Validated flow:

1. register a fresh user
2. bootstrap vault
3. verify recovery-key screen appears before the dashboard
4. create a zero-knowledge item
5. view and locally reveal the zero-knowledge payload
6. register a `local_cli` agent
7. create a valid permission for that agent and item
8. verify audit page loads and URL-backed result filter works
9. lock the vault
10. unlock the vault and return to the dashboard

Security note from QA:

* attempting to permission a zero-knowledge item to the default `remote_agent` agent correctly fails with `Remote agents cannot access zero-knowledge items.`

## Issues found and fixed

1. Circular tRPC router initialization crashed local API startup.
   Fix: split shared tRPC initialization into `packages/trpc/src/server/init.ts`.

2. Effect failures were surfacing as generic tRPC internal errors.
   Fix: unwrap Effect fiber failures before domain-error mapping.

3. `vault.setupRecovery` incorrectly succeeded before vault bootstrap.
   Fix: require an existing vault row before recovery update.

4. Session bearer auth did not accept raw Better Auth session tokens for SDK/CLI callers.
   Fix: resolve bearer tokens through Better Auth internal session lookup before API-key fallback.

5. Dashboard vault bootstrap skipped the recovery-key screen.
   Fix: give recovery-key UI precedence over the unlocked-state branch.

6. Dashboard React Query keys were inconsistent across queries and mutations.
   Fix: introduce shared dashboard query-key helpers and use them consistently.

7. CLI daemon lifecycle was wired to a non-existent executable and stop path was wrong.
   Fix: spawn the current CLI entrypoint in internal daemon-serve mode and use real stop RPC.

8. Root `bun run test` failed because `apps/api` had no tests.
   Fix: add a Hono health-route smoke test with explicit test env bindings.

## Docs updated

Updated to match verified behavior:

* `docs/API.md`
* `docs/ARCHITECTURE.md`
* `docs/CLI.md`
* `docs/DEVELOPMENT.md`
* `docs/SECURITY.md`

Notable doc corrections:

* removed stale `apps/cli` binary references
* documented scripted CLI login flags
* documented daemon spawn/stop behavior
* documented bearer use of raw Better Auth session tokens
* corrected local Postgres database example to `abadge`

## Residual notes

* Root `bun run db:migrate` still depends on a correctly scoped Doppler project providing `DATABASE_URL`.
* The branch code and direct migration path are verified; the remaining mismatch is local Doppler configuration, not application behavior.
