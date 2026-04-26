"use client";

import type { Agent, ItemSummary, Permission } from "@abadge/core";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useQueryStates } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CreatePermissionPanel } from "@/components/dashboard/create-permission-panel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CapabilityBadge } from "@/components/ui/capability-badge";
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
import {
  type CapabilityFilter,
  type ExpiryFilter,
  permissionsFilterParsers,
} from "@/lib/query-state";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { cn, formatDate } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

const PAGE_SIZE = 25;

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const remaining = new Date(expiresAt).getTime() - Date.now();
  return remaining > 0 && remaining < 7 * 24 * 60 * 60 * 1000; // 7 days
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function matchesExpiryFilter(expiresAt: string | null, filter: ExpiryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "permanent") return !expiresAt;
  if (filter === "expired") return isExpired(expiresAt);
  if (filter === "expiring") return isExpiringSoon(expiresAt);
  return true;
}

function filterPermissions(
  permissions: Permission[],
  search: string,
  agentFilter: string,
  capabilityFilter: CapabilityFilter,
  expiryFilter: ExpiryFilter,
  agentNameMap: Map<string, string>,
  itemLabelMap: Map<string, string>,
): Permission[] {
  let result = permissions;

  if (search) {
    const lower = search.toLowerCase();
    result = result.filter((p: Permission) => {
      const agentName = agentNameMap.get(p.agentId)?.toLowerCase() ?? "";
      const itemLabel = itemLabelMap.get(p.itemId)?.toLowerCase() ?? "";
      return agentName.includes(lower) || itemLabel.includes(lower);
    });
  }

  if (agentFilter !== "all") {
    result = result.filter((p: Permission) => p.agentId === agentFilter);
  }

  if (capabilityFilter !== "all") {
    result = result.filter((p: Permission) => p.capability === capabilityFilter);
  }

  if (expiryFilter !== "all") {
    result = result.filter((p: Permission) => matchesExpiryFilter(p.expiresAt, expiryFilter));
  }

  return result;
}

/* ---- Filter chips ---- */

function FilterChips({
  search,
  agentFilter,
  capabilityFilter,
  expiryFilter,
  agentNameMap,
  onClearSearch,
  onClearAgent,
  onClearCapability,
  onClearExpiry,
  onClearAll,
}: {
  search: string;
  agentFilter: string;
  capabilityFilter: CapabilityFilter;
  expiryFilter: ExpiryFilter;
  agentNameMap: Map<string, string>;
  onClearSearch: () => void;
  onClearAgent: () => void;
  onClearCapability: () => void;
  onClearExpiry: () => void;
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
      {agentFilter !== "all" && (
        <Badge variant="secondary" className="gap-1">
          Agent: {agentNameMap.get(agentFilter) ?? agentFilter.slice(0, 12)}
          <button type="button" onClick={onClearAgent} className="ml-0.5">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {capabilityFilter !== "all" && (
        <Badge variant="secondary" className="gap-1">
          Capability: {capabilityFilter}
          <button type="button" onClick={onClearCapability} className="ml-0.5">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}
      {expiryFilter !== "all" && (
        <Badge variant="secondary" className="gap-1">
          Expiry: {expiryFilter}
          <button type="button" onClick={onClearExpiry} className="ml-0.5">
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

/* ---- Permissions table ---- */

function PermissionsTable({
  isPending,
  visiblePermissions,
  totalCount,
  agentNameMap,
  itemLabelMap,
  onRevoke,
  isRevoking,
}: {
  isPending: boolean;
  visiblePermissions: Permission[];
  totalCount: number;
  agentNameMap: Map<string, string>;
  itemLabelMap: Map<string, string>;
  onRevoke: (permissionId: string) => void;
  isRevoking: boolean;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Capability</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Granted by</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isPending ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                Loading...
              </TableCell>
            </TableRow>
          ) : visiblePermissions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                <div className="space-y-2">
                  <div className="font-medium text-foreground">
                    {totalCount === 0 ? "No permissions yet" : "No permissions match your filters"}
                  </div>
                  <div>
                    {totalCount === 0
                      ? "Grant your first permission to get started."
                      : "Try adjusting your search or filters."}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            visiblePermissions.map((perm: Permission) => (
              <PermissionRow
                key={perm.id}
                permission={perm}
                agentName={agentNameMap.get(perm.agentId) ?? perm.agentId.slice(0, 12)}
                itemLabel={itemLabelMap.get(perm.itemId) ?? perm.itemId.slice(0, 12)}
                onRevoke={() => onRevoke(perm.id)}
                isRevoking={isRevoking}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---- Main page ---- */

export default function PermissionsListPage(): React.ReactElement {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const activeOrgName = useOrgStore((s) => s.activeOrgName);

  const [filters, setFilters] = useQueryStates(permissionsFilterParsers, {
    history: "replace",
    clearOnDefault: true,
  });
  const {
    q: search,
    agent: agentFilter,
    capability: capabilityFilter,
    expiry: expiryFilter,
    create: createOpen,
  } = filters;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset pagination when any filter changes (incl. via URL/back-forward)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — reset on filter change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, agentFilter, capabilityFilter, expiryFilter]);

  const queryClient = useQueryClient();

  const permissionsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgPermissions(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.permissions.list.query({}),
    enabled: !!activeOrgId,
  });
  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.agents.list.query(),
    enabled: !!activeOrgId,
  });
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.items.list.query(),
    enabled: !!activeOrgId,
  });

  const permissions = permissionsQuery.data?.permissions ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const items = itemsQuery.data?.items ?? [];

  const agentNameMap = useMemo(
    () => new Map<string, string>(agents.map((a: Agent) => [a.id, a.name])),
    [agents],
  );
  const itemLabelMap = useMemo(
    () => new Map<string, string>(items.map((i: ItemSummary) => [i.id, i.label])),
    [items],
  );

  const filteredPermissions = useMemo(
    () =>
      filterPermissions(
        permissions,
        search,
        agentFilter,
        capabilityFilter,
        expiryFilter,
        agentNameMap,
        itemLabelMap,
      ),
    [permissions, search, agentFilter, capabilityFilter, expiryFilter, agentNameMap, itemLabelMap],
  );

  const visiblePermissions = filteredPermissions.slice(0, visibleCount);
  const hasMore = visibleCount < filteredPermissions.length;

  const hasActiveFilters =
    search !== "" || agentFilter !== "all" || capabilityFilter !== "all" || expiryFilter !== "all";

  function clearFilters(): void {
    void setFilters({
      q: "",
      agent: "all",
      capability: "all",
      expiry: "all",
    });
  }

  const revokeMutation = useMutation({
    mutationFn: (permissionId: string) =>
      browserTrpcClient.permissions.revoke.mutate({ permissionId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgPermissions(activeOrgId ?? ""),
      });
      toast.success("Permission revoked.");
    },
    onError: (error) => {
      toast.error(getClientErrorMessage(error, "Failed to revoke permission"));
    },
  });

  const activeAgents = useMemo(
    () =>
      agents
        .filter((a: Agent) => a.enabled && !a.revokedAt)
        .sort((a: Agent, b: Agent) => a.name.localeCompare(b.name)),
    [agents],
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/overview" className="hover:text-foreground">
          {activeOrgName}
        </Link>
        <span>/</span>
        <span className="text-foreground">Permissions</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-semibold">Permissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Explicit capability grants — each links one agent to one item with one capability.
          </p>
        </div>
        <Button size="sm" onClick={() => void setFilters({ create: true })}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Grant permission
        </Button>
      </div>

      {/* Search and filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <MagnifyingGlass className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search agent or item..."
            value={search}
            onChange={(e) => void setFilters({ q: e.target.value })}
            className="pl-8"
          />
        </div>

        <select
          value={agentFilter}
          onChange={(e) => void setFilters({ agent: e.target.value })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All agents</option>
          {activeAgents.map((a: Agent) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          value={capabilityFilter}
          onChange={(e) => void setFilters({ capability: e.target.value as CapabilityFilter })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All capabilities</option>
          <option value="read_ciphertext">read_ciphertext</option>
          <option value="reveal_plaintext">reveal_plaintext</option>
          <option value="mount_env">mount_env</option>
          <option value="mount_file">mount_file</option>
        </select>

        <select
          value={expiryFilter}
          onChange={(e) => void setFilters({ expiry: e.target.value as ExpiryFilter })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All expiry</option>
          <option value="permanent">Permanent</option>
          <option value="expiring">Expiring soon</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Active filter chips */}
      {hasActiveFilters && (
        <FilterChips
          search={search}
          agentFilter={agentFilter}
          capabilityFilter={capabilityFilter}
          expiryFilter={expiryFilter}
          agentNameMap={agentNameMap}
          onClearSearch={() => void setFilters({ q: "" })}
          onClearAgent={() => void setFilters({ agent: "all" })}
          onClearCapability={() => void setFilters({ capability: "all" })}
          onClearExpiry={() => void setFilters({ expiry: "all" })}
          onClearAll={clearFilters}
        />
      )}

      {/* Count */}
      <div className="text-sm text-muted-foreground">
        {filteredPermissions.length} permission{filteredPermissions.length !== 1 ? "s" : ""}
      </div>

      {/* Permissions table */}
      <PermissionsTable
        isPending={permissionsQuery.isPending}
        visiblePermissions={visiblePermissions}
        totalCount={permissions.length}
        agentNameMap={agentNameMap}
        itemLabelMap={itemLabelMap}
        onRevoke={(id) => revokeMutation.mutate(id)}
        isRevoking={revokeMutation.isPending}
      />

      {/* Footer with count and load more */}
      {visiblePermissions.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {visiblePermissions.length} of {filteredPermissions.length} permissions
          </span>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            >
              Load more
            </Button>
          )}
        </div>
      )}

      <CreatePermissionPanel open={createOpen} onClose={() => void setFilters({ create: false })} />
    </div>
  );
}

function PermissionRow({
  permission,
  agentName,
  itemLabel,
  onRevoke,
  isRevoking,
}: {
  permission: Permission;
  agentName: string;
  itemLabel: string;
  onRevoke: () => void;
  isRevoking: boolean;
}): React.ReactElement {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const expired = isExpired(permission.expiresAt);
  const expiringSoon = isExpiringSoon(permission.expiresAt);

  return (
    <TableRow>
      <TableCell className="font-medium">{agentName}</TableCell>
      <TableCell className="text-sm">{itemLabel}</TableCell>
      <TableCell>
        <CapabilityBadge capability={permission.capability} />
      </TableCell>
      <TableCell
        className={cn(
          "whitespace-nowrap text-sm",
          expired && "text-red-600 dark:text-red-400",
          expiringSoon && !expired && "text-red-600 dark:text-red-400",
          !expired && !expiringSoon && "text-muted-foreground",
        )}
      >
        {permission.expiresAt ? (expired ? "Expired" : formatDate(permission.expiresAt)) : "Never"}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {permission.grantedBy.slice(0, 12)}
      </TableCell>
      <TableCell className="text-right">
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700 dark:text-red-400"
            >
              Revoke
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke permission</AlertDialogTitle>
              <AlertDialogDescription>
                This will immediately revoke the &ldquo;{permission.capability}&rdquo; capability
                for &ldquo;{agentName}&rdquo; on &ldquo;{itemLabel}&rdquo;. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  onRevoke();
                  setConfirmOpen(false);
                }}
                disabled={isRevoking}
              >
                {isRevoking ? "Revoking..." : "Revoke"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}
