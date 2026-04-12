"use client";

import {
  AUDIT_EVENT_TYPES,
  AUDIT_RESULTS,
  type AuditEntry,
  type AuditEventType,
  type AuditResult,
} from "@abadge/core";
import { useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  resolveAuditDisplayValue,
} from "@/lib/audit-display";
import { dashboardQueryKeys } from "@/lib/query-keys";
import {
  type AuditEventTypeFilter,
  type AuditResultFilter,
  auditFilterParsers,
} from "@/lib/query-state";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "outline";

function resultBadgeVariant(result: string): BadgeVariant {
  switch (result) {
    case "allowed":
    case "success":
      return "success";
    case "denied":
    case "error":
      return "destructive";
    case "pending":
      return "warning";
    default:
      return "secondary";
  }
}

const COLUMN_COUNT = 6;

export default function AuditPage(): React.ReactElement {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([]);
  const [{ eventType: eventTypeFilter, result: resultFilter }, setAuditFilters] =
    useQueryStates(auditFilterParsers);
  const limit = 50;
  const input = {
    limit,
    cursor,
    ...(eventTypeFilter !== "all" ? { eventType: eventTypeFilter as AuditEventType } : {}),
    ...(resultFilter !== "all" ? { result: resultFilter as AuditResult } : {}),
  };
  const auditQuery = useQuery({
    queryKey: dashboardQueryKeys.audit(input),
    queryFn: () => browserTrpcClient.audit.list.query(input),
  });
  const logs = auditQuery.data?.entries ?? [];
  const itemIds = useMemo<string[]>(
    () =>
      Array.from(
        new Set<string>(logs.flatMap((log: AuditEntry) => (log.itemId ? [log.itemId] : []))),
      ).sort(),
    [logs],
  );
  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.agents(),
    queryFn: () => browserTrpcClient.agents.list.query(),
  });
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.items(),
    queryFn: () => browserTrpcClient.items.list.query(),
    enabled: itemIds.length > 0,
  });
  const agentNames = useMemo(
    () => buildAuditAgentNameMap(agentsQuery.data?.agents ?? []),
    [agentsQuery.data?.agents],
  );
  const itemLabels = useMemo(
    () => buildAuditItemLabelMap(itemsQuery.data?.items ?? []),
    [itemsQuery.data?.items],
  );
  const nextCursor = auditQuery.data?.nextCursor ?? null;
  const hasMore = Boolean(nextCursor);

  function resetPagination(): void {
    setCursor(undefined);
    setCursorStack([]);
  }

  function handleEventTypeFilterChange(value: string): void {
    void setAuditFilters({
      eventType: value as AuditEventTypeFilter,
    });
    resetPagination();
  }

  function handleResultFilterChange(value: string): void {
    void setAuditFilters({
      result: value as AuditResultFilter,
    });
    resetPagination();
  }

  function handleNext(): void {
    if (!nextCursor) {
      return;
    }

    setCursorStack((prev) => [...prev, cursor]);
    setCursor(nextCursor);
  }

  function handlePrevious(): void {
    if (cursorStack.length === 0) {
      return;
    }

    const previousCursor = cursorStack[cursorStack.length - 1];
    setCursorStack((prev) => prev.slice(0, -1));
    setCursor(previousCursor);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Every access attempt is recorded</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Event type</p>
          <Select value={eventTypeFilter} onValueChange={handleEventTypeFilterChange}>
            <SelectTrigger className="w-[160px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {AUDIT_EVENT_TYPES.map((eventType) => (
                <SelectItem key={eventType} value={eventType}>
                  {eventType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Result</p>
          <Select value={resultFilter} onValueChange={handleResultFilterChange}>
            <SelectTrigger className="w-[140px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {AUDIT_RESULTS.map((result) => (
                <SelectItem key={result} value={result}>
                  {result}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditQuery.error ? (
              <TableRow>
                <TableCell colSpan={COLUMN_COUNT} className="text-center py-8 text-red-700">
                  {getClientErrorMessage(auditQuery.error, "Failed to load audit log")}
                </TableCell>
              </TableRow>
            ) : auditQuery.isPending ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="text-center py-8 text-muted-foreground"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="text-center py-12 text-muted-foreground"
                >
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No audit logs</div>
                    <div>Logs appear when items are accessed.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log: AuditEntry) => {
                const agentDisplay = resolveAuditDisplayValue(log.agentId, agentNames);
                const itemDisplay = resolveAuditDisplayValue(log.itemId, itemLabels);

                return (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatRelativeTime(log.occurredAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.eventType}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={resultBadgeVariant(log.result)}>{log.result}</Badge>
                    </TableCell>
                    <TableCell
                      className={
                        agentDisplay.resolved
                          ? "text-sm text-foreground"
                          : "font-mono text-sm text-muted-foreground"
                      }
                    >
                      {agentDisplay.text}
                    </TableCell>
                    <TableCell
                      className={
                        itemDisplay.resolved
                          ? "text-sm text-foreground"
                          : "font-mono text-sm text-muted-foreground"
                      }
                    >
                      {itemDisplay.text}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground text-xs font-mono">
                      {log.meta ? JSON.stringify(log.meta) : "\u2014"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {(cursorStack.length > 0 || hasMore) && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={cursorStack.length === 0}
            onClick={handlePrevious}
          >
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!hasMore} onClick={handleNext}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
