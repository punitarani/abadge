"use client";

import { clientEnv } from "@abadge/env/client";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";

interface AuditEntry {
  id: number;
  agentId: string;
  credentialId: string;
  credentialName: string;
  agentName: string;
  action: "read" | "denied";
  purpose: string | null;
  ipAddress: string | null;
  timestamp: string;
}

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchLogs = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      try {
        const res = await fetch(`${apiUrl}/api/audit?limit=${limit}&offset=${newOffset}`, {
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
    [apiUrl],
  );

  useEffect(() => {
    fetchLogs(0);
  }, [fetchLogs]);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-lg font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">Every credential access attempt is recorded</p>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Credential</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Purpose</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No access logs</div>
                    <div>Logs appear when agents request credentials.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(log.timestamp)}
                  </TableCell>
                  <TableCell className="font-medium">{log.agentName}</TableCell>
                  <TableCell>{log.credentialName}</TableCell>
                  <TableCell>
                    <Badge variant={log.action === "read" ? "success" : "destructive"}>
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {log.purpose ?? "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {log.ipAddress ?? "\u2014"}
                  </TableCell>
                </TableRow>
              ))
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
