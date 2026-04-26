"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { useOrgStore } from "@/stores/org-store";

export type PrefetchableRoute =
  | "overview"
  | "profiles"
  | "items"
  | "agents"
  | "permissions"
  | "audit"
  | "settings";

/**
 * Returns a stable map of prefetcher callbacks, one per dashboard route. Each
 * callback warms the React Query cache for the queries that route's page
 * fires on mount, so by the time the user releases the mouse on a sidebar
 * link the cache is already hot.
 *
 * Notes:
 *   - Each callback no-ops when there's no `activeOrgId` (caller should still
 *     be allowed to fire it without guarding).
 *   - `prefetchQuery` respects the QueryClient's `staleTime`, so repeated
 *     hovers on a fresh entry are free.
 *   - `audit` prefetches the lookup queries used by the page's UI, but NOT
 *     the main audit list — that one is filter-driven and would prefetch a
 *     different key than the user actually mounts.
 */
export function useRoutePrefetcher(): Record<PrefetchableRoute, () => void> {
  const queryClient = useQueryClient();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);

  const prefetchProfiles = useCallback(() => {
    if (!activeOrgId) return;
    void queryClient.prefetchQuery({
      queryKey: dashboardQueryKeys.profiles(activeOrgId),
      queryFn: () => browserTrpcClient.profiles.list.query({ orgId: activeOrgId }),
    });
  }, [queryClient, activeOrgId]);

  const prefetchItems = useCallback(() => {
    if (!activeOrgId) return;
    void queryClient.prefetchQuery({
      queryKey: dashboardQueryKeys.orgItems(activeOrgId),
      queryFn: () => browserTrpcClient.items.list.query(),
    });
  }, [queryClient, activeOrgId]);

  const prefetchAgents = useCallback(() => {
    if (!activeOrgId) return;
    void queryClient.prefetchQuery({
      queryKey: dashboardQueryKeys.orgAgents(activeOrgId),
      queryFn: () => browserTrpcClient.agents.list.query(),
    });
  }, [queryClient, activeOrgId]);

  const prefetchPermissions = useCallback(() => {
    if (!activeOrgId) return;
    void queryClient.prefetchQuery({
      queryKey: dashboardQueryKeys.orgPermissions(activeOrgId),
      queryFn: () => browserTrpcClient.permissions.list.query({}),
    });
  }, [queryClient, activeOrgId]);

  const prefetchOrganization = useCallback(() => {
    if (!activeOrgId) return;
    void queryClient.prefetchQuery({
      queryKey: dashboardQueryKeys.organization(activeOrgId),
      queryFn: () => browserTrpcClient.organizations.get.query({ orgId: activeOrgId }),
    });
  }, [queryClient, activeOrgId]);

  const prefetchMembers = useCallback(() => {
    if (!activeOrgId) return;
    void queryClient.prefetchQuery({
      queryKey: dashboardQueryKeys.orgMembers(activeOrgId),
      queryFn: () => browserTrpcClient.organizations.members.list.query({ orgId: activeOrgId }),
    });
  }, [queryClient, activeOrgId]);

  return useMemo(
    () => ({
      overview: () => {
        prefetchProfiles();
        prefetchItems();
        prefetchAgents();
        prefetchPermissions();
      },
      profiles: prefetchProfiles,
      items: () => {
        prefetchItems();
        prefetchPermissions();
      },
      agents: prefetchAgents,
      permissions: () => {
        prefetchPermissions();
        prefetchItems();
        prefetchAgents();
      },
      audit: () => {
        prefetchAgents();
        prefetchItems();
      },
      settings: () => {
        prefetchOrganization();
        prefetchMembers();
        prefetchItems();
      },
    }),
    [
      prefetchProfiles,
      prefetchItems,
      prefetchAgents,
      prefetchPermissions,
      prefetchOrganization,
      prefetchMembers,
    ],
  );
}
