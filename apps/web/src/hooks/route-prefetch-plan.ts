import type { QueryKey } from "@tanstack/react-query";
import { DRAIN_PAGE_SIZE, drainAll } from "@/lib/drain-all";
import { dashboardQueryKeys } from "@/lib/query-keys";

export type PrefetchableRoute =
  | "overview"
  | "profiles"
  | "items"
  | "agents"
  | "permissions"
  | "audit"
  | "settings";

/**
 * Minimal interface over `browserTrpcClient` covering exactly the procedures
 * the prefetcher invokes. Declared here (rather than imported from the trpc
 * client) so {@link buildPrefetchPlan} stays pure and testable — the test
 * passes a stub client matching this shape.
 */
type ListPageInput = { cursor?: string; limit?: number };

export interface PrefetchClient {
  profiles: { list: { query: (args: { orgId: string }) => Promise<unknown> } };
  // List endpoints are cursor-paginated; the prefetch drains every page so the
  // warmed cache matches what the page component reads (which also drains).
  // Warming only the first page would leave the page trusting a truncated cache
  // and silently hiding rows past the first page.
  items: {
    list: {
      query: (
        input: ListPageInput,
      ) => Promise<{ items: readonly unknown[]; nextCursor: string | null }>;
    };
  };
  agents: {
    list: {
      query: (
        input: ListPageInput,
      ) => Promise<{ agents: readonly unknown[]; nextCursor: string | null }>;
    };
  };
  permissions: {
    list: {
      query: (
        input: ListPageInput,
      ) => Promise<{ permissions: readonly unknown[]; nextCursor: string | null }>;
    };
  };
  organizations: {
    get: { query: (args: { orgId: string }) => Promise<unknown> };
    members: { list: { query: (args: { orgId: string }) => Promise<unknown> } };
  };
}

/**
 * One unit of prefetch work: the cache key it warms and the queryFn that
 * fulfills it. Bundled together so `buildPrefetchPlan` returns a pure
 * description that a caller (the hook) feeds into `prefetchQuery`.
 */
export interface PrefetchEntry {
  queryKey: QueryKey;
  queryFn: () => Promise<unknown>;
}

/**
 * Pure function: given a route, the active org, and a tRPC client, return
 * the prefetch entries that route's page consumes on first mount. No React,
 * no hooks, no zustand — designed to be unit-testable with a stub client.
 *
 * Returns an empty array when `activeOrgId` is missing — no org context,
 * nothing meaningful to warm.
 *
 * Notes per route:
 *   - `audit` warms only the lookup queries (agents, items) shared with the
 *     page's UI. The main `audit.list` is filter-driven (cursor + URL-state
 *     filters), so the cache key the user actually mounts depends on URL
 *     state — a hover-prefetch with default-empty filters would warm a
 *     different key than the one the page reads after URL state is parsed.
 *     The audit table itself will still cold-fetch on first paint; the
 *     lookup data warming is the navigation win here.
 *   - `settings` does NOT warm `orgItems`. The settings page reads it for
 *     the danger-zone item count, but that's a tertiary section — warming
 *     on hover/focus is wasted bandwidth in the common case.
 */
export function buildPrefetchPlan(
  route: PrefetchableRoute,
  activeOrgId: string | null,
  client: PrefetchClient,
): PrefetchEntry[] {
  if (!activeOrgId) return [];

  const profiles: PrefetchEntry = {
    queryKey: dashboardQueryKeys.profiles(activeOrgId),
    queryFn: () => client.profiles.list.query({ orgId: activeOrgId }),
  };
  const items: PrefetchEntry = {
    queryKey: dashboardQueryKeys.orgItems(activeOrgId),
    queryFn: async () => ({
      items: await drainAll(async (cursor) => {
        const page = await client.items.list.query({ cursor, limit: DRAIN_PAGE_SIZE });
        return { rows: page.items, nextCursor: page.nextCursor };
      }),
      nextCursor: null,
    }),
  };
  const agents: PrefetchEntry = {
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId),
    queryFn: async () => ({
      agents: await drainAll(async (cursor) => {
        const page = await client.agents.list.query({ cursor, limit: DRAIN_PAGE_SIZE });
        return { rows: page.agents, nextCursor: page.nextCursor };
      }),
      nextCursor: null,
    }),
  };
  const permissions: PrefetchEntry = {
    queryKey: dashboardQueryKeys.orgPermissions(activeOrgId),
    queryFn: async () => ({
      permissions: await drainAll(async (cursor) => {
        const page = await client.permissions.list.query({ cursor, limit: DRAIN_PAGE_SIZE });
        return { rows: page.permissions, nextCursor: page.nextCursor };
      }),
      nextCursor: null,
    }),
  };
  const organization: PrefetchEntry = {
    queryKey: dashboardQueryKeys.organization(activeOrgId),
    queryFn: () => client.organizations.get.query({ orgId: activeOrgId }),
  };
  const members: PrefetchEntry = {
    queryKey: dashboardQueryKeys.orgMembers(activeOrgId),
    queryFn: () => client.organizations.members.list.query({ orgId: activeOrgId }),
  };

  switch (route) {
    case "overview":
      return [profiles, items, agents, permissions];
    case "profiles":
      return [profiles];
    case "items":
      return [items, permissions];
    case "agents":
      return [agents];
    case "permissions":
      return [permissions, items, agents];
    case "audit":
      return [agents, items];
    case "settings":
      return [organization, members];
  }
}
