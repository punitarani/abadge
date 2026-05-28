import { DRAIN_PAGE_SIZE, drainAll } from "./drain-all";
import { browserTrpcClient } from "./trpc-browser";

/**
 * Browser-client list helpers that return the *full* org dataset by draining
 * every page (§AB-0050). The dashboard filters and joins these client-side, so
 * a single capped page would silently hide rows beyond the first 50.
 *
 * Return types are derived from the tRPC client itself (not the core schema) so
 * they match exactly what the page components already consume — the wrappers
 * are a drop-in replacement for `browserTrpcClient.<x>.list.query({})`.
 */

type ItemsListResult = Awaited<ReturnType<typeof browserTrpcClient.items.list.query>>;
type AgentsListResult = Awaited<ReturnType<typeof browserTrpcClient.agents.list.query>>;
type PermissionsListResult = Awaited<ReturnType<typeof browserTrpcClient.permissions.list.query>>;

export async function listAllItems(): Promise<ItemsListResult> {
  const items = await drainAll<ItemsListResult["items"][number]>(async (cursor) => {
    const page = await browserTrpcClient.items.list.query({ cursor, limit: DRAIN_PAGE_SIZE });
    return { rows: page.items, nextCursor: page.nextCursor };
  });
  return { items, nextCursor: null };
}

export async function listAllAgents(): Promise<AgentsListResult> {
  const agents = await drainAll<AgentsListResult["agents"][number]>(async (cursor) => {
    const page = await browserTrpcClient.agents.list.query({ cursor, limit: DRAIN_PAGE_SIZE });
    return { rows: page.agents, nextCursor: page.nextCursor };
  });
  return { agents, nextCursor: null };
}

export async function listAllPermissions(): Promise<PermissionsListResult> {
  const permissions = await drainAll<PermissionsListResult["permissions"][number]>(
    async (cursor) => {
      const page = await browserTrpcClient.permissions.list.query({
        cursor,
        limit: DRAIN_PAGE_SIZE,
      });
      return { rows: page.permissions, nextCursor: page.nextCursor };
    },
  );
  return { permissions, nextCursor: null };
}
