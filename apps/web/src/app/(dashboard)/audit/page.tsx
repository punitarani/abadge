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
  id: number;
  agentId: string;
  credentialId: string;
  credentialName: string;
  agentName: string;
  action: string;
  outcome: string | null;
  deliveryMode: string | null;
  principalType: string | null;
  environment: string | null;
  sessionId: string | null;
  destination: string | null;
  connectorUsed: string | null;
  purpose: string | null;
  ipAddress: string | null;
  timestamp: string;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "outline";

function resolveOutcome(entry: AuditEntry): string {
  if (entry.outcome) return entry.outcome;
  if (entry.action === "read") return "allowed";
  if (entry.action === "denied") return "denied";
  return entry.action;
}

function outcomeBadgeVariant(outcome: string): BadgeVariant {
  switch (outcome) {
    case "allowed":
      return "success";
    case "denied":
      return "destructive";
    case "pending_approval":
      return "warning";
    case "expired":
      return "secondary";
    default:
      return "default";
  }
}

function deliveryModeLabel(mode: string): string {
  switch (mode) {
    case "reveal":
      return "Reveal";
    case "env_inject":
      return "Env Inject";
    case "file_mount_tmpfs":
      return "File Mount";
    case "browser_fill":
      return "Browser Fill";
    case "operation_only":
      return "Op Only";
    default:
      return mode;
  }
}

function envBadgeVariant(env: string): BadgeVariant {
  switch (env) {
    case "prod":
      return "destructive";
    case "staging":
      return "warning";
    case "dev":
      return "secondary";
    default:
      return "default";
  }
}

const COLUMN_COUNT = 9;

function AuditRow({ log }: { log: AuditEntry }): React.JSX.Element {
  const outcome = resolveOutcome(log);
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {formatRelativeTime(log.timestamp)}
      </TableCell>
      <TableCell className="font-medium">{log.agentName}</TableCell>
      <TableCell>{log.credentialName}</TableCell>
      <TableCell>
        <Badge variant={outcomeBadgeVariant(outcome)}>{outcome}</Badge>
      </TableCell>
      <TableCell>
        {log.deliveryMode ? (
          <Badge variant={log.deliveryMode === "reveal" ? "default" : "secondary"}>
            {deliveryModeLabel(log.deliveryMode)}
          </Badge>
        ) : (
          <span className="text-muted-foreground">{"\u2014"}</span>
        )}
      </TableCell>
      <TableCell>
        {log.environment ? (
          <Badge variant={envBadgeVariant(log.environment)}>{log.environment}</Badge>
        ) : (
          <span className="text-muted-foreground">{"\u2014"}</span>
        )}
      </TableCell>
      <TableCell className="max-w-xs truncate text-muted-foreground">
        {log.purpose ?? "\u2014"}
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-xs">
        {log.ipAddress ?? "\u2014"}
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {log.sessionId ? log.sessionId.slice(0, 8) : "\u2014"}
      </TableCell>
    </TableRow>
  );
}

export default function AuditPage(): React.JSX.Element {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [deliveryModeFilter, setDeliveryModeFilter] = useState("all");
  const [principalTypeFilter, setPrincipalTypeFilter] = useState("all");
  const [environmentFilter, setEnvironmentFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchLogs = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(newOffset),
        });
        if (outcomeFilter !== "all") params.set("outcome", outcomeFilter);
        if (deliveryModeFilter !== "all") params.set("deliveryMode", deliveryModeFilter);
        if (principalTypeFilter !== "all") params.set("principalType", principalTypeFilter);
        if (environmentFilter !== "all") params.set("environment", environmentFilter);
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);

        const res = await fetch(`${apiUrl}/api/audit?${params.toString()}`, {
          credentials: "include",
        });
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs);
          setOffset(newOffset);
        }
      } finally {
        setLoading(false);
      }
    },
    [outcomeFilter, deliveryModeFilter, principalTypeFilter, environmentFilter, startDate, endDate],
  );

  useEffect(() => {
    fetchLogs(0);
  }, [fetchLogs]);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Every credential access attempt is recorded</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Outcome</label>
          <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
            <SelectTrigger className="w-[140px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="allowed">Allowed</SelectItem>
              <SelectItem value="denied">Denied</SelectItem>
              <SelectItem value="pending_approval">Pending Approval</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Delivery Mode</label>
          <Select value={deliveryModeFilter} onValueChange={setDeliveryModeFilter}>
            <SelectTrigger className="w-[150px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="reveal">Reveal</SelectItem>
              <SelectItem value="env_inject">Env Inject</SelectItem>
              <SelectItem value="file_mount_tmpfs">File Mount</SelectItem>
              <SelectItem value="browser_fill">Browser Fill</SelectItem>
              <SelectItem value="operation_only">Operation Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Principal Type</label>
          <Select value={principalTypeFilter} onValueChange={setPrincipalTypeFilter}>
            <SelectTrigger className="w-[130px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="human">Human</SelectItem>
              <SelectItem value="app">App</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="workload">Workload</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Environment</label>
          <Select value={environmentFilter} onValueChange={setEnvironmentFilter}>
            <SelectTrigger className="w-[120px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="dev">Dev</SelectItem>
              <SelectItem value="staging">Staging</SelectItem>
              <SelectItem value="prod">Prod</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="flex h-[28px] rounded-md border border-input bg-neutral-50 px-2 text-xs text-foreground"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">End date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="flex h-[28px] rounded-md border border-input bg-neutral-50 px-2 text-xs text-foreground"
          />
        </div>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Credential</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Env</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Session</TableHead>
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
                    <div className="font-medium text-foreground">No access logs</div>
                    <div>Logs appear when agents request credentials.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => <AuditRow key={log.id} log={log} />)
            )}
          </TableBody>
        </Table>
      </div>

      {logs.length > 0 && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => fetchLogs(Math.max(0, offset - limit))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={logs.length < limit}
            onClick={() => fetchLogs(offset + limit)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
