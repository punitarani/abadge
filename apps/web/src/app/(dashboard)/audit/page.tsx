"use client";

import {
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  type AuditEntry,
  type AuditEventType,
  type AuditResult,
  type Profile,
} from "@abadge/core";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
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
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

type DateRangeFilter = "7d" | "30d" | "all";

const PAGE_SIZE = 25;
const COLUMN_COUNT = 7;

function dateRangeThreshold(range: DateRangeFilter): Date | null {
  if (range === "all") return null;
  const now = Date.now();
  const ms = range === "7d" ? 7 * 86_400_000 : 30 * 86_400_000;
  return new Date(now - ms);
}

function rowHighlightClass(result: string): string | undefined {
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
  isInitialLoad,
  entries,
  agentNames,
  itemLabels,
  profileNames,
}: {
  error: Error | null;
  isPending: boolean;
  isInitialLoad: boolean;
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

  if (isPending && isInitialLoad) {
    return (
      <TableRow>
        <TableCell colSpan={COLUMN_COUNT} className="py-8 text-center text-muted-foreground">
          Loading...
        </TableCell>
      </TableRow>
    );
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

  const [search, setSearch] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<"all" | AuditEventType>("all");
  const [resultFilter, setResultFilter] = useState<"all" | AuditResult>("all");
  const [profileFilter, setProfileFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRangeFilter>("all");

  // Accumulated entries for "Load more" pattern
  const [allEntries, setAllEntries] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const apiInput = useMemo(
    () => ({
      limit: PAGE_SIZE,
      cursor,
      ...(eventTypeFilter !== "all" ? { eventType: eventTypeFilter } : {}),
      ...(resultFilter !== "all" ? { result: resultFilter } : {}),
      ...(profileFilter !== "all" ? { profileId: profileFilter } : {}),
    }),
    [cursor, eventTypeFilter, resultFilter, profileFilter],
  );

  const auditQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAudit(activeOrgId ?? "", apiInput),
    queryFn: async () => {
      const result = await browserTrpcClient.audit.list.query(apiInput);
      if (isInitialLoad) {
        setAllEntries(result.entries);
        setIsInitialLoad(false);
      } else {
        setAllEntries((prev) => [...prev, ...result.entries]);
      }
      setNextCursor(result.nextCursor ?? null);
      return result;
    },
    enabled: !!activeOrgId,
    // Prevent automatic refetches from duplicating accumulated entries.
    // Each cursor-based page is a distinct query key, so pagination still works.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // Reset pagination when filters change
  const resetPagination = useCallback(() => {
    setAllEntries([]);
    setCursor(undefined);
    setNextCursor(null);
    setIsInitialLoad(true);
  }, []);

  function handleLoadMore(): void {
    if (nextCursor) {
      setCursor(nextCursor);
    }
  }

  // Lookup data
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

  const totalLoaded = allEntries.length;
  const hasMore = Boolean(nextCursor);

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
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <select
          value={eventTypeFilter}
          onChange={(e) => {
            setEventTypeFilter(e.target.value as "all" | AuditEventType);
            resetPagination();
          }}
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
          onChange={(e) => {
            setResultFilter(e.target.value as "all" | AuditResult);
            resetPagination();
          }}
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
          onChange={(e) => {
            setProfileFilter(e.target.value);
            resetPagination();
          }}
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
          onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border">
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
              isInitialLoad={isInitialLoad}
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
            Showing {filteredEntries.length} of {hasMore ? `${totalLoaded}+` : totalLoaded} events
          </span>
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={auditQuery.isFetching}
            >
              {auditQuery.isFetching ? "Loading..." : "Load more"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
