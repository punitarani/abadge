---
"@abadge/web": patch
---

Optimize dashboard navigation:

- Stream layout-shaped skeletons via `loading.tsx` for every dashboard route (overview, profiles, items, agents, permissions, audit, settings, plus dynamic `[id]` routes)
- Tune the React Query client for SPA-style caching: 1-minute `staleTime`, 10-minute `gcTime`, no `refetchOnWindowFocus`, refetch on reconnect
- Prefetch primary tRPC queries on sidebar link hover/focus via a new `useRoutePrefetcher` hook with a 100 ms settle debounce
- Replace the nuclear `queryClient.invalidateQueries()` on org switch with a no-op (org-scoped query keys already include orgId)
- Restructure the dashboard layout into a persistent shell + inner `DashboardGate`, so the sidebar never unmounts on transient session/org state changes
- Guard `OrgSwitcher`'s `organizations.list` query on session presence to avoid pre-auth 401s after the shell restructure
- Enable Next 15's `optimizePackageImports` for `lucide-react`, `@phosphor-icons/react`, and `radix-ui`; pin `lucide-react` (was `latest`)
