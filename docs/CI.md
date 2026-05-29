# Continuous integration

## Test jobs and coverage

`.github/workflows/ci-cd.yml` runs three test jobs in parallel after typecheck:

| Job | What runs | Postgres | Coverage artifact |
|---|---|---|---|
| `test-unit` | `bun run test:cov:unit` | no | `coverage-unit` (`coverage/unit/lcov.info`) |
| `test-integration` | `bun run test:cov:integration` | yes | `coverage-integration` (`coverage/integration/lcov.info`) |
| `test-web` | `bun run --cwd apps/web test` | no | none (web is out of scope) |
| `e2e` | `bun run test:e2e` | yes | none (see below) |

E2E tests boot `wrangler dev` and the compiled CLI/MCP binaries; Bun's coverage instrumentation only sees JS in the running bun process, so it cannot produce meaningful coverage across the workerd / compiled-binary boundary. The same code paths are exercised in-process by the integration bucket. E2E is kept as a behavioral-fidelity bucket and intentionally excluded from coverage.

Bucket assignment (the source of truth) lives in `scripts/coverage/buckets.ts`.

A `coverage-comment` job (PRs only) downloads both lcov artifacts, renders the report via `scripts/coverage/comment.ts`, and posts/updates a sticky PR comment via [`marocchino/sticky-pull-request-comment`](https://github.com/marocchino/sticky-pull-request-comment) (header: `coverage`). The job runs even if a test bucket fails (`if: always()`) and continues on missing artifacts so partial info still posts.

The comment opens with a **Change vs base** section — an Improved / Maintained / Worsened verdict plus per-bucket line/function deltas — followed by the absolute **Totals** table. The verdict is conservative: a regression in any bucket marks the whole PR worsened, otherwise any gain marks it improved. Deltas are compared on the rendered 2-decimal percentages, so sub-0.005% jitter reads as "maintained".

The baseline is supplied by the `coverage-baseline` job, which runs only on push to `main`: it snapshots that run's lcov files into the GitHub Actions cache under key `coverage-baseline-<sha>`. PR runs restore it with the `coverage-baseline-` restore-key prefix — branch runs can read the default branch's cache, so this resolves to main's tip. Until `main` has run the job at least once there is no baseline, and the comment shows a "no baseline yet" note instead of the diff.

Coverage is informational on this PR — no thresholds gate CI. The artifacts (`coverage-unit`, `coverage-integration`) on each run hold the full lcov files for local rendering (`bunx genhtml coverage/unit/lcov.info -o coverage/unit/html`) or editor inline-coverage extensions.

## Caching and concurrency

Every job sets up Bun and installs dependencies through the local composite
action [`.github/actions/setup`](../.github/actions/setup/action.yml), which
restores the Bun install store (`~/.bun/install/cache`, keyed on `bun.lock`)
before `bun install --frozen-lockfile`. Repeat runs reuse the store instead of
fetching every dependency cold in each job.

The `typecheck`, `build-api`, and `build-web` jobs additionally cache Turbo's
local output dir (`.turbo`, keyed per job on the commit SHA with a rolling
restore-key) so unchanged packages skip work across runs. This is independent
of the optional remote cache below.

The workflow sets `concurrency` keyed on the ref with `cancel-in-progress`
enabled for `pull_request` events only: rapid pushes to a PR cancel the
superseded run, while pushes to `main` are never cancelled so an in-flight
deploy or migration always finishes.

There is no separate format job — `bun run lint` (`biome check`) already
enforces formatting alongside lint rules and import order.

## Turborepo remote cache (optional)

GitHub Actions runs `turbo` for `typecheck`, `test`, and filtered `build` / `build:workers` tasks so
[Vercel Remote Cache](https://vercel.com/docs/monorepos/remote-caching) can speed up repeated work
across CI runs and developers (when the same credentials are configured locally).

Configure the repository:

| Name | Type | Description |
|------|------|-------------|
| `TURBO_TEAM` | GitHub Actions **variable** | Vercel team slug (or id) from the Turborepo dashboard |
| `TURBO_TOKEN` | GitHub Actions **secret** | Remote cache token with read/write for that team |

If these are unset, Turbo falls back to local caching only inside each job (no cross-run sharing).

## Deploy jobs and worker secrets

`deploy-api` / `deploy-web` (push to `main` only) run each app's `deploy` script under
`doppler run`. That script **deploys the worker first, then syncs secrets** from Doppler via
`scripts/sync-worker-secrets.ts` (`wrangler secret bulk`).

The order matters: Cloudflare rejects a bulk secret edit when the worker's latest version
isn't the deployed one (Workers Versions guard, API error `10215`). Pushing secrets before
`wrangler deploy` therefore fails. Deploying first makes the latest version live, so the
subsequent secret sync is allowed. A `--check` pre-step still validates that every required
secret is present in the environment before anything is deployed, so a missing Doppler value
aborts up front rather than after a partial deploy.
