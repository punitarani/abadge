# Continuous integration

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
