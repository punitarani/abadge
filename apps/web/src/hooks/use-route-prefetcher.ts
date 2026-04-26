"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";
import {
  buildPrefetchPlan,
  type PrefetchableRoute,
  type PrefetchClient,
} from "./route-prefetch-plan";

export type { PrefetchableRoute } from "./route-prefetch-plan";

/**
 * Returns a stable map of prefetcher callbacks, one per dashboard route.
 * Each callback warms the React Query cache for the queries that route's
 * page fires on mount, so by the time the user releases the mouse on a
 * sidebar link the cache is already hot.
 *
 *   - Each callback no-ops when there's no `activeOrgId` (caller can fire
 *     unconditionally).
 *   - `prefetchQuery` respects the QueryClient's `staleTime`, so repeated
 *     hovers on a fresh entry are free.
 *   - The route → query-keys mapping is extracted to {@link buildPrefetchPlan}
 *     in `route-prefetch-plan.ts` so it can be unit-tested without React.
 */
export function useRoutePrefetcher(): Record<PrefetchableRoute, () => void> {
  const queryClient = useQueryClient();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);

  const make = useCallback(
    (route: PrefetchableRoute) => () => {
      const plan = buildPrefetchPlan(
        route,
        activeOrgId,
        browserTrpcClient as unknown as PrefetchClient,
      );
      for (const entry of plan) {
        void queryClient.prefetchQuery({
          queryKey: entry.queryKey,
          queryFn: entry.queryFn,
        });
      }
    },
    [queryClient, activeOrgId],
  );

  return useMemo(
    () => ({
      overview: make("overview"),
      profiles: make("profiles"),
      items: make("items"),
      agents: make("agents"),
      permissions: make("permissions"),
      audit: make("audit"),
      settings: make("settings"),
    }),
    [make],
  );
}
