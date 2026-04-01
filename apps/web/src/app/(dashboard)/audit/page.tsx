"use client";

import { clientEnv } from "@abadge/env/client";
import { useCallback, useEffect, useState } from "react";
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
import { formatRelativeTime } from "@/lib/utils";

interface AuditEntry {
  id: string;
  eventType: string;
  result: string;
  principalId: string | null;
  principalName: string | null;
  itemId: string | null;
  itemName: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

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
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const limit = 50;

  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchLogs = useCallback(
    async (pageCursor: string | null) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ limit: String(limit) });
        if (pageCursor) params.set("cursor", pageCursor);
        if (eventTypeFilter !== "all") params.set("eventType", eventTypeFilter);
        if (resultFilter !== "all") params.set("result", resultFilter);

        const res = await fetch(`${apiUrl}/v1/audit?${params.toString()}`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs ?? []);
          setCursor(data.nextCursor ?? null);
          setHasMore(!!data.nextCursor);
        }
      } finally {
        setLoading(false);
      }
    },
    [apiUrl, eventTypeFilter, resultFilter],
  );

  useEffect(() => {
    setCursorStack([]);
    fetchLogs(null);
  }, [fetchLogs]);

  function handleNext(): void {
    if (!cursor) return;
    setCursorStack((prev) => [...prev, logs[0]?.id ?? ""]);
    fetchLogs(cursor);
  }

  function handlePrevious(): void {
    const newStack = [...cursorStack];
    newStack.pop();
    setCursorStack(newStack);
    const prevCursor = newStack.length > 0 ? (newStack[newStack.length - 1] ?? null) : null;
    fetchLogs(prevCursor);
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Every access attempt is recorded</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Event type</label>
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-[160px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="item.read">Item read</SelectItem>
              <SelectItem value="item.create">Item create</SelectItem>
              <SelectItem value="item.delete">Item delete</SelectItem>
              <SelectItem value="grant.create">Grant create</SelectItem>
              <SelectItem value="grant.revoke">Grant revoke</SelectItem>
              <SelectItem value="principal.create">Principal create</SelectItem>
              <SelectItem value="principal.delete">Principal delete</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Result</label>
          <Select value={resultFilter} onValueChange={setResultFilter}>
            <SelectTrigger className="w-[140px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="allowed">Allowed</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
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
              <TableHead>Principal</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
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
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatRelativeTime(log.timestamp)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.eventType}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={resultBadgeVariant(log.result)}>{log.result}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {log.principalName ?? log.principalId ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {log.itemName ?? log.itemId ?? "\u2014"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground text-xs font-mono">
                    {log.metadata ? JSON.stringify(log.metadata) : "\u2014"}
                  </TableCell>
                </TableRow>
              ))
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
