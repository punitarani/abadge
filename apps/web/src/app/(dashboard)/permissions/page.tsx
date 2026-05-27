"use client";

import {
  type Agent,
  CAPABILITIES,
  type Capability,
  type ItemSummary,
  type Permission,
} from "@abadge/core";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { debounce, useQueryStates } from "nuqs";
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

interface PermissionGroup {
  agentId: string;
  // §RM-PR2 — itemId is null for profile-target grants. The grouping key
  // builds in a synthetic "profile:<profileId>" token so item and profile
  // grants for the same agent never collide.
  itemId: string | null;
  profileId: string | null;
  permissions: Permission[];
}

const CAPABILITY_ORDER: ReadonlyMap<Capability, number> = new Map(
  CAPABILITIES.map((cap, idx) => [cap, idx]),
);

function groupPermissionsByPair(
  permissions: Permission[],
  agentNameMap: Map<string, string>,
  itemLabelMap: Map<string, string>,
): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const p of permissions) {
    const targetKey = p.itemId ?? `profile:${p.profileId ?? "?"}`;
    const key = `${p.agentId}::${targetKey}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        agentId: p.agentId,
        itemId: p.itemId,
        profileId: p.profileId,
        permissions: [],
      };
      groups.set(key, group);
    }
    group.permissions.push(p);
  }

  for (const group of groups.values()) {
    group.permissions.sort((a, b) => {
      const ai = CAPABILITY_ORDER.get(a.capability as Capability) ?? 99;
      const bi = CAPABILITY_ORDER.get(b.capability as Capability) ?? 99;
      return ai - bi;
    });
  }

  return Array.from(groups.values()).sort((a, b) => {
    const an = agentNameMap.get(a.agentId) ?? a.agentId;
    const bn = agentNameMap.get(b.agentId) ?? b.agentId;
    if (an !== bn) return an.localeCompare(bn);
    const aTarget = a.itemId
      ? (itemLabelMap.get(a.itemId) ?? a.itemId)
      : `profile:${a.profileId ?? ""}`;
    const bTarget = b.itemId
      ? (itemLabelMap.get(b.itemId) ?? b.itemId)
      : `profile:${b.profileId ?? ""}`;
    return aTarget.localeCompare(bTarget);
  });
}

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
      const itemLabel = p.itemId
        ? (itemLabelMap.get(p.itemId)?.toLowerCase() ?? "")
        : (p.profileId?.toLowerCase() ?? "");
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
  visibleGroups,
  totalGroupCount,
  agentNameMap,
  itemLabelMap,
  profileNameMap,
  onRevoke,
  isRevoking,
}: {
  isPending: boolean;
  visibleGroups: PermissionGroup[];
  totalGroupCount: number;
  agentNameMap: Map<string, string>;
  itemLabelMap: Map<string, string>;
  profileNameMap: Map<string, string>;
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
            <TableHead>Capabilities</TableHead>
            <TableHead>Expires</TableHead>
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
          ) : visibleGroups.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                <div className="space-y-2">
                  <div className="font-medium text-foreground">
                    {totalGroupCount === 0
                      ? "No permissions yet"
                      : "No permissions match your filters"}
                  </div>
                  <div>
                    {totalGroupCount === 0
                      ? "Grant your first permission to get started."
                      : "Try adjusting your search or filters."}
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            visibleGroups.map((group) => {
              const targetKey = group.itemId ?? `profile:${group.profileId ?? "?"}`;
              const targetLabel = group.itemId
                ? (itemLabelMap.get(group.itemId) ?? group.itemId.slice(0, 12))
                : group.profileId
                  ? `profile:${profileNameMap.get(group.profileId) ?? group.profileId.slice(0, 12)}`
                  : "profile:?";
              return (
                <PermissionGroupRow
                  key={`${group.agentId}::${targetKey}`}
                  group={group}
                  agentName={agentNameMap.get(group.agentId) ?? group.agentId.slice(0, 12)}
                  itemLabel={targetLabel}
                  onRevoke={onRevoke}
                  isRevoking={isRevoking}
                />
              );
            })
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
    limitUrlUpdates: debounce(250),
  });
  const {
    q: search,
    agent: agentFilter,
    capability: capabilityFilter,
    expiry: expiryFilter,
    create: createOpen,
  } = filters;
  const [visibleGroupCount, setVisibleGroupCount] = useState(PAGE_SIZE);

  // Reset pagination when any filter changes (incl. via URL/back-forward)
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — reset on filter change
  useEffect(() => {
    setVisibleGroupCount(PAGE_SIZE);
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
  // §REVAMP-PR5 — Look up profile names so profile-target grants render
  // as `profile:<name>` rather than `profile:<id-prefix>`.
  const profilesQuery = useQuery({
    queryKey: dashboardQueryKeys.profiles(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.profiles.list.query({ orgId: activeOrgId ?? "" }),
    enabled: !!activeOrgId,
  });

  const permissions = permissionsQuery.data?.permissions ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const items = itemsQuery.data?.items ?? [];
  const profilesList = profilesQuery.data?.profiles ?? [];

  const agentNameMap = useMemo(
    () => new Map<string, string>(agents.map((a: Agent) => [a.id, a.name])),
    [agents],
  );
  const itemLabelMap = useMemo(
    () => new Map<string, string>(items.map((i: ItemSummary) => [i.id, i.label])),
    [items],
  );
  const profileNameMap = useMemo(
    () =>
      new Map<string, string>(
        profilesList.map((p: { id: string; name: string }) => [p.id, p.name]),
      ),
    [profilesList],
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

  const groupedPermissions = useMemo(
    () => groupPermissionsByPair(filteredPermissions, agentNameMap, itemLabelMap),
    [filteredPermissions, agentNameMap, itemLabelMap],
  );

  const visibleGroups = groupedPermissions.slice(0, visibleGroupCount);
  const hasMore = visibleGroupCount < groupedPermissions.length;

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
            Each row is one (agent, item) pair. Capabilities are explicit grants — revoke any chip
            individually.
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
          {CAPABILITIES.map((cap) => (
            <option key={cap} value={cap}>
              {cap}
            </option>
          ))}
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
        {filteredPermissions.length} permission{filteredPermissions.length !== 1 ? "s" : ""} across{" "}
        {groupedPermissions.length}{" "}
        {groupedPermissions.length === 1 ? "agent–item pair" : "agent–item pairs"}
      </div>

      {/* Permissions table */}
      <PermissionsTable
        isPending={permissionsQuery.isPending}
        visibleGroups={visibleGroups}
        totalGroupCount={groupedPermissions.length}
        agentNameMap={agentNameMap}
        itemLabelMap={itemLabelMap}
        profileNameMap={profileNameMap}
        onRevoke={(id) => revokeMutation.mutate(id)}
        isRevoking={revokeMutation.isPending}
      />

      {/* Footer with count and load more */}
      {visibleGroups.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {visibleGroups.length} of {groupedPermissions.length}{" "}
            {groupedPermissions.length === 1 ? "pair" : "pairs"}
          </span>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVisibleGroupCount((prev) => prev + PAGE_SIZE)}
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

function PermissionGroupRow({
  group,
  agentName,
  itemLabel,
  onRevoke,
  isRevoking,
}: {
  group: PermissionGroup;
  agentName: string;
  itemLabel: string;
  onRevoke: (permissionId: string) => void;
  isRevoking: boolean;
}): React.ReactElement {
  // Group expiry: use the soonest non-null expiresAt across the group's
  // capabilities so an operator scanning the column sees the most urgent
  // deadline first. "Mixed" appears when caps have different expiries.
  const expiryDisplay = useMemo(() => summarizeGroupExpiry(group.permissions), [group.permissions]);

  return (
    <TableRow>
      <TableCell className="font-medium align-top">{agentName}</TableCell>
      <TableCell className="text-sm align-top">{itemLabel}</TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap gap-1.5">
          {group.permissions.map((perm) => (
            <CapabilityChip
              key={perm.id}
              permission={perm}
              agentName={agentName}
              itemLabel={itemLabel}
              onRevoke={() => onRevoke(perm.id)}
              isRevoking={isRevoking}
            />
          ))}
        </div>
      </TableCell>
      <TableCell
        className={cn(
          "whitespace-nowrap text-sm align-top",
          expiryDisplay.tone === "danger" && "text-red-600 dark:text-red-400",
          expiryDisplay.tone === "neutral" && "text-muted-foreground",
        )}
      >
        {expiryDisplay.label}
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

interface ExpirySummary {
  label: string;
  tone: "neutral" | "danger";
}

function summarizeGroupExpiry(permissions: Permission[]): ExpirySummary {
  const expiries = permissions.map((p) => p.expiresAt);
  const allPermanent = expiries.every((e) => e === null);
  if (allPermanent) {
    return { label: "Never", tone: "neutral" };
  }
  const distinct = new Set(expiries.map((e) => e ?? "permanent"));
  if (distinct.size > 1) {
    // Elevate to danger when any expiry has already passed — the Expires
    // column should not look fine when one chip is already dead.
    const hasExpired = expiries.some((e) => e !== null && isExpired(e));
    return { label: "Mixed", tone: hasExpired ? "danger" : "neutral" };
  }
  const first = expiries.find((e) => e !== null) ?? null;
  if (!first) {
    return { label: "Never", tone: "neutral" };
  }
  if (isExpired(first)) {
    return { label: "Expired", tone: "danger" };
  }
  if (isExpiringSoon(first)) {
    return { label: formatDate(first), tone: "danger" };
  }
  return { label: formatDate(first), tone: "neutral" };
}

function CapabilityChip({
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
  const tooltip = [
    // §AB-0043 — grantedBy is null when the granting user was deleted (grant survives).
    `Granted by ${permission.grantedBy?.slice(0, 12) ?? "(deleted user)"}`,
    `Created ${formatDate(permission.createdAt)}`,
    permission.expiresAt
      ? `${expired ? "Expired" : "Expires"} ${formatDate(permission.expiresAt)}`
      : "No expiry",
  ].join(" · ");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
        "border-border bg-background",
        (expired || expiringSoon) && "border-red-300 dark:border-red-900/60",
      )}
      title={tooltip}
    >
      <CapabilityBadge capability={permission.capability} />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            aria-label={`Revoke ${permission.capability}`}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
          >
            <X className="h-3 w-3" />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke permission</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke the &ldquo;{permission.capability}&rdquo; capability for
              &ldquo;{agentName}&rdquo; on &ldquo;{itemLabel}&rdquo;. Other capabilities for this
              pair will remain. This cannot be undone.
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
    </span>
  );
}
