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

Coverage is informational on this PR — no thresholds gate CI. Download the `coverage-unit` / `coverage-integration` artifacts from a green run to inspect.

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
