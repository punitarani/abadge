"use client";

import type { ItemSummary } from "@abadge/core";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CreateItemPanel } from "@/components/dashboard/create-item-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

type StorageFilter = "all" | "zero_knowledge" | "server_managed";

function storageLabel(mode: string): string {
  return mode === "zero_knowledge" ? "Zero-knowledge" : "Server-managed";
}

function StorageDot({ mode }: { mode: string }): React.ReactElement {
  const isZK = mode === "zero_knowledge";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block h-2 w-2 rounded-full ${isZK ? "bg-emerald-500" : "bg-blue-500"}`}
      />
      <span>{storageLabel(mode)}</span>
    </span>
  );
}

export default function ItemsListPage(): React.ReactElement {
  const params = useParams<{ org: string }>();
  const orgSlug = params.org;
  const searchParams = useSearchParams();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const activeOrgName = useOrgStore((s) => s.activeOrgName);

  const [search, setSearch] = useState("");
  const [storageFilter, setStorageFilter] = useState<StorageFilter>("all");
  const [createOpen, setCreateOpen] = useState(searchParams.get("create") === "true");

  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.items.list.query(),
    enabled: !!activeOrgId,
  });

  const permissionsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgPermissions(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.permissions.list.query({}),
    enabled: !!activeOrgId,
  });

  const items = itemsQuery.data?.items ?? [];
  const permissions = permissionsQuery.data?.permissions ?? [];

  const agentCountsByItem = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const p of permissions) {
      const set = map.get(p.itemId) ?? new Set<string>();
      set.add(p.agentId);
      map.set(p.itemId, set);
    }
    return map;
  }, [permissions]);

  const filteredItems = useMemo(() => {
    let result = items;

    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((item: ItemSummary) => item.label.toLowerCase().includes(lower));
    }

    if (storageFilter !== "all") {
      result = result.filter((item: ItemSummary) => item.storageMode === storageFilter);
    }

    return result;
  }, [items, search, storageFilter]);

  const hasActiveFilters = search !== "" || storageFilter !== "all";

  function clearFilters(): void {
    setSearch("");
    setStorageFilter("all");
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href={`/${orgSlug}/overview`} className="hover:text-foreground">
          {activeOrgName ?? orgSlug}
        </Link>
        <span>/</span>
        <span className="text-foreground">Items</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Items</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Encrypted credentials and secrets stored in your vault.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add item
        </Button>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <MagnifyingGlass className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <select
          value={storageFilter}
          onChange={(e) => setStorageFilter(e.target.value as StorageFilter)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All storage</option>
          <option value="zero_knowledge">Zero-knowledge</option>
          <option value="server_managed">Server-managed</option>
        </select>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <FilterChips
          search={search}
          storageFilter={storageFilter}
          onClearSearch={() => setSearch("")}
          onClearStorage={() => setStorageFilter("all")}
          onClearAll={clearFilters}
        />
      )}

      {/* Items table */}
      <ItemsTable
        isPending={itemsQuery.isPending}
        items={filteredItems}
        totalCount={items.length}
        agentCountsByItem={agentCountsByItem}
        orgSlug={orgSlug}
      />

      <CreateItemPanel open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/* ---- Sub-components ---- */

function FilterChips({
  search,
  storageFilter,
  onClearSearch,
  onClearStorage,
  onClearAll,
}: {
  search: string;
  storageFilter: StorageFilter;
  onClearSearch: () => void;
  onClearStorage: () => void;
  onClearAll: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {search && (
        <Badge variant="secondary" className="gap-1">
          Search: {search}
          <button type="button" onClick={onClearSearch} className="ml-0.5">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {storageFilter !== "all" && (
        <Badge variant="secondary" className="gap-1">
          {storageLabel(storageFilter)}
          <button type="button" onClick={onClearStorage} className="ml-0.5">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        Clear all
      </button>
    </div>
  );
}

function ItemsTable({
  isPending,
  items,
  totalCount,
  agentCountsByItem,
  orgSlug,
}: {
  isPending: boolean;
  items: ItemSummary[];
  totalCount: number;
  agentCountsByItem: Map<string, Set<string>>;
  orgSlug: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Storage</TableHead>
            <TableHead>Agents</TableHead>
            <TableHead>Created</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                Loading...
              </TableCell>
            </TableRow>
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                <div className="space-y-2">
                  <div className="font-medium text-foreground">
                    {totalCount === 0 ? "No items yet" : "No items match your filters"}
                  </div>
                  <div>
                    {totalCount === 0
                      ? "Add your first secret to get started."
                      : "Try adjusting your search or filters."}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            items.map((item: ItemSummary) => (
              <TableRow key={item.id} className="cursor-pointer">
                <TableCell className="font-medium">
                  <Link href={`/${orgSlug}/items/${item.id}`}>{item.label}</Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <StorageDot mode={item.storageMode} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {agentCountsByItem.get(item.id)?.size ?? 0}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatRelativeTime(item.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/${orgSlug}/items/${item.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
