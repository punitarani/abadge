"use client";

import {
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  type AuditEntry,
  type AuditResult,
  type Profile,
} from "@abadge/core";
import { ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { debounce, useQueryStates } from "nuqs";
import { useMemo } from "react";
import { TableRowsSkeleton } from "@/components/dashboard/skeletons/table-rows-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResultBadge } from "@/components/ui/result-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildAuditAgentNameMap,
  buildAuditItemLabelMap,
  buildProfileNameMap,
  resolveAuditDisplayValue,
} from "@/lib/audit-display";
import { listAllAgents, listAllItems } from "@/lib/list-queries";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { type AuditDateRangeFilter, auditFilterParsers } from "@/lib/query-state";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 7;

function dateRangeThreshold(range: AuditDateRangeFilter): Date | null {
  if (range === "all") return null;
  const now = Date.now();
  const ms = range === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
  return new Date(now - ms);
}

function rowHighlightClass(result: AuditResult): string | undefined {
  switch (result) {
    case "denied":
    case "revoked":
      return "bg-red-50/30 dark:bg-red-950/10";
    case "expired":
      return "bg-yellow-50/50 dark:bg-yellow-950/20";
    default:
      return undefined;
  }
}

function AuditRow({
  log,
  agentNames,
  itemLabels,
  profileNames,
}: {
  log: AuditEntry;
  agentNames: Map<string, string>;
  itemLabels: Map<string, string>;
  profileNames: Map<string, string>;
}): React.ReactElement {
  const agentDisplay = resolveAuditDisplayValue(log.agentId, agentNames);
  const itemDisplay = resolveAuditDisplayValue(log.itemId, itemLabels);
  const profileName = log.profileId ? profileNames.get(log.profileId) : null;

  return (
    <TableRow className={cn(rowHighlightClass(log.result))}>
      <TableCell
        className={
          agentDisplay.resolved ? "text-sm font-medium" : "font-mono text-sm text-muted-foreground"
        }
      >
        {agentDisplay.text}
      </TableCell>
      <TableCell
        className={itemDisplay.resolved ? "text-sm" : "font-mono text-sm text-muted-foreground"}
      >
        {itemDisplay.text}
      </TableCell>
      <TableCell>
        {profileName ? (
          <Badge variant="outline">{profileName}</Badge>
        ) : (
          <span className="text-muted-foreground">{"\u2014"}</span>
        )}
      </TableCell>
      <TableCell className="text-sm">{log.eventType}</TableCell>
      <TableCell>
        <ResultBadge result={log.result} />
      </TableCell>
      <TableCell className="font-mono text-sm text-muted-foreground">
        {log.ipAddress ?? "\u2014"}
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {formatRelativeTime(log.occurredAt)}
      </TableCell>
    </TableRow>
  );
}

function AuditTableBody({
  error,
  isPending,
  entries,
  agentNames,
  itemLabels,
  profileNames,
}: {
  error: Error | null;
  isPending: boolean;
  entries: AuditEntry[];
  agentNames: Map<string, string>;
  itemLabels: Map<string, string>;
  profileNames: Map<string, string>;
}): React.ReactElement {
  if (error) {
    return (
      <TableRow>
        <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-red-700">
          {getClientErrorMessage(error, "Failed to load audit log")}
        </TableCell>
      </TableRow>
    );
  }

  if (isPending) {
    return <TableRowsSkeleton columns={COLUMN_COUNT} rows={8} />;
  }

  if (entries.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={COLUMN_COUNT} className="py-12 text-center text-muted-foreground">
          <div className="space-y-2">
            <div className="font-medium text-foreground">No audit logs</div>
            <div>Logs appear when items are accessed.</div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {entries.map((log: AuditEntry) => (
        <AuditRow
          key={log.id}
          log={log}
          agentNames={agentNames}
          itemLabels={itemLabels}
          profileNames={profileNames}
        />
      ))}
    </>
  );
}

export default function AuditPage(): React.ReactElement {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const activeOrgName = useOrgStore((s) => s.activeOrgName);
  const queryClient = useQueryClient();

  const [filters, setFilters] = useQueryStates(auditFilterParsers, {
    history: "replace",
    clearOnDefault: true,
    limitUrlUpdates: debounce(250),
  });
  const {
    q: search,
    event: eventTypeFilter,
    result: resultFilter,
    profile: profileFilter,
    range: dateRange,
  } = filters;

  // Server-side filter slice — drives the queryKey. When this changes,
  // useInfiniteQuery resets pages atomically (no manual cursor/initialLoad
  // bookkeeping, no race between filter and cursor state).
  const serverFilters = useMemo(
    () => ({
      ...(eventTypeFilter !== "all" ? { eventType: eventTypeFilter } : {}),
      ...(resultFilter !== "all" ? { result: resultFilter } : {}),
      ...(profileFilter !== "all" ? { profileId: profileFilter } : {}),
    }),
    [eventTypeFilter, resultFilter, profileFilter],
  );

  const auditQuery = useInfiniteQuery({
    queryKey: dashboardQueryKeys.orgAudit(activeOrgId ?? "", serverFilters),
    queryFn: ({ pageParam }) =>
      browserTrpcClient.audit.list.query({
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
        ...serverFilters,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!activeOrgId,
    // Keep the current rows on screen while a filter change refetches, instead
    // of flashing the table back to a skeleton; the wrapper dims to signal the
    // in-flight update (see `isRefreshing`).
    placeholderData: keepPreviousData,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const allEntries = useMemo<AuditEntry[]>(
    () => auditQuery.data?.pages.flatMap((p) => p.entries) ?? [],
    [auditQuery.data?.pages],
  );
  const hasMore = auditQuery.hasNextPage;
  // A background refetch with rows already on screen (filter change or manual
  // refresh) — distinct from the first cold load (isPending) and from appending
  // the next page (isFetchingNextPage). Dim the table to acknowledge the update
  // without yanking the current rows away.
  const isRefreshing =
    auditQuery.isFetching && !auditQuery.isPending && !auditQuery.isFetchingNextPage;

  function handleLoadMore(): void {
    void auditQuery.fetchNextPage();
  }

  function handleRefresh(): void {
    if (!activeOrgId) return;
    // Wipe every cached audit page for this org so useInfiniteQuery refetches
    // from page 1. Plain invalidateQueries would refetch each cached page in
    // place, which is worse: more requests, and any new rows that landed
    // mid-window would be missed.
    queryClient.removeQueries({ queryKey: dashboardQueryKeys.orgAuditPrefix(activeOrgId) });
    void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.orgAgents(activeOrgId) });
    void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.orgItems(activeOrgId) });
    void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.profiles(activeOrgId) });
  }

  // Lookup data
  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
    queryFn: () => listAllAgents(),
    enabled: !!activeOrgId,
  });
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => listAllItems(),
    enabled: !!activeOrgId,
  });
  const profilesQuery = useQuery({
    queryKey: dashboardQueryKeys.profiles(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.profiles.list.query({ orgId: activeOrgId ?? "" }),
    enabled: !!activeOrgId,
  });

  const agentNames = useMemo(
    () => buildAuditAgentNameMap(agentsQuery.data?.agents ?? []),
    [agentsQuery.data?.agents],
  );
  const itemLabels = useMemo(
    () => buildAuditItemLabelMap(itemsQuery.data?.items ?? []),
    [itemsQuery.data?.items],
  );
  const profileNames = useMemo(
    () => buildProfileNameMap(profilesQuery.data?.profiles ?? []),
    [profilesQuery.data?.profiles],
  );
  const profiles = profilesQuery.data?.profiles ?? [];

  // Client-side filtering for search and date range
  const filteredEntries = useMemo(() => {
    let entries = allEntries;

    // Date range filter (client-side)
    const threshold = dateRangeThreshold(dateRange);
    if (threshold) {
      entries = entries.filter((e) => new Date(e.occurredAt) >= threshold);
    }

    // Text search filter (client-side)
    if (search) {
      const lower = search.toLowerCase();
      entries = entries.filter((e) => {
        const agentName = e.agentId ? (agentNames.get(e.agentId)?.toLowerCase() ?? "") : "";
        const itemLabel = e.itemId ? (itemLabels.get(e.itemId)?.toLowerCase() ?? "") : "";
        const ip = e.ipAddress?.toLowerCase() ?? "";
        return agentName.includes(lower) || itemLabel.includes(lower) || ip.includes(lower);
      });
    }

    return entries;
  }, [allEntries, search, dateRange, agentNames, itemLabels]);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/overview" className="hover:text-foreground">
          {activeOrgName}
        </Link>
        <span>/</span>
        <span className="text-foreground">Audit log</span>
      </nav>

      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only record of every access attempt. Includes allowed, denied, expired, and revoked
          outcomes.
        </p>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <MagnifyingGlass className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search agent, item, or IP..."
            value={search}
            onChange={(e) => void setFilters({ q: e.target.value })}
            className="pl-8"
          />
        </div>

        <select
          value={eventTypeFilter}
          onChange={(e) => void setFilters({ event: e.target.value as typeof eventTypeFilter })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All events</option>
          {AUDIT_EVENT_TYPES.map((et) => (
            <option key={et} value={et}>
              {et}
            </option>
          ))}
        </select>

        <select
          value={resultFilter}
          onChange={(e) => void setFilters({ result: e.target.value as typeof resultFilter })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All results</option>
          {AUDIT_RESULTS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select
          value={profileFilter}
          onChange={(e) => void setFilters({ profile: e.target.value })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All profiles</option>
          {profiles.map((p: Profile) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={dateRange}
          onChange={(e) => void setFilters({ range: e.target.value as typeof dateRange })}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>

        <Button
          variant="outline"
          size="icon"
          onClick={handleRefresh}
          disabled={!activeOrgId || auditQuery.isFetching}
          aria-label="Refresh audit log"
          className="ml-auto"
        >
          <ArrowClockwise
            className={cn("h-4 w-4", auditQuery.isFetching && "animate-spin")}
            aria-hidden="true"
          />
        </Button>
      </div>

      {/* Table */}
      <div
        className={cn(
          "rounded-lg border border-border transition-opacity",
          isRefreshing && "opacity-60",
        )}
        aria-busy={isRefreshing}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>IP address</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AuditTableBody
              error={auditQuery.error}
              isPending={auditQuery.isPending}
              entries={filteredEntries}
              agentNames={agentNames}
              itemLabels={itemLabels}
              profileNames={profileNames}
            />
          </TableBody>
        </Table>
      </div>

      {/* Footer */}
      {filteredEntries.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {filteredEntries.length} of{" "}
            {hasMore ? `${allEntries.length}+` : allEntries.length} events
          </span>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={auditQuery.isFetchingNextPage}
            >
              {auditQuery.isFetchingNextPage ? "Loading..." : "Load more"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
