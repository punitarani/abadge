"use client";

import type { ItemSummary } from "@abadge/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { dashboardQueryKeys } from "./query-keys";
import { browserTrpcClient } from "./trpc-browser";

/**
 * Resolves item display labels via `items.resolveDisplay`.
 * Server-managed items get their decrypted label; ZK items fall back to a truncated ID.
 */
export function useItemLabels(items: ItemSummary[]): {
  labelMap: Map<string, string>;
  isLoading: boolean;
} {
  const itemIds = useMemo(() => items.map((i) => i.id), [items]);

  const displayQuery = useQuery({
    queryKey: dashboardQueryKeys.itemDisplay(itemIds),
    queryFn: () => browserTrpcClient.items.resolveDisplay.query({ itemIds }),
    enabled: itemIds.length > 0,
  });

  const labelMap = useMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const entry of displayQuery.data?.items ?? []) {
      if ("label" in entry && entry.label) {
        map.set(entry.itemId, entry.label);
      }
    }
    return map;
  }, [displayQuery.data]);

  return { labelMap, isLoading: displayQuery.isPending };
}

export function resolveItemLabel(
  itemId: string,
  labelMap: Map<string, string>,
  storageMode?: string,
): string {
  const label = labelMap.get(itemId);
  if (label) return label;
  const prefix =
    storageMode === "zero_knowledge" ? "ZK" : storageMode === "server_managed" ? "Srv" : null;
  const shortId = `${itemId.slice(0, 8)}…`;
  return prefix ? `${prefix} · ${shortId}` : shortId;
}
