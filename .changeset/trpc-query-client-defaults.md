---
"@abadge/cli": patch
---

Tune the React `createTrpcQueryClient` defaults in `@abadge/trpc` for SPA-style dashboard caching: 1-minute `staleTime`, 10-minute `gcTime`, `refetchOnWindowFocus: false`, `refetchOnReconnect: "always"`. The CLI does not instantiate the React QueryClient (it only uses `createNodeTrpcClient`), so this changeset documents that the CLI's release surface includes the touched `packages/trpc/` file even though there is no behavior change for CLI users.
