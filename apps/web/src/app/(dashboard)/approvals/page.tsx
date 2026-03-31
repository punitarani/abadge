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

interface ApprovalEntry {
  id: string;
  requesterId: string;
  approverId: string | null;
  credentialId: string;
  agentId: string;
  status: "pending" | "approved" | "denied" | "expired";
  deliveryMode: string;
  reason: string | null;
  decidedAt: string | null;
  expiresAt: string;
  createdAt: string;
  credentialName?: string;
  agentName?: string;
}

type StatusFilter = "all" | "pending" | "approved" | "denied";

const statusVariant: Record<
  ApprovalEntry["status"],
  "warning" | "success" | "destructive" | "secondary"
> = {
  pending: "warning",
  approved: "success",
  denied: "destructive",
  expired: "secondary",
};

export default function ApprovalsPage(): React.ReactElement {
  const [approvals, setApprovals] = useState<ApprovalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [actioning, setActioning] = useState<string | null>(null);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/v1/approvals`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setApprovals(data.approvals as ApprovalEntry[]);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleAction = useCallback(
    async (id: string, action: "approve" | "deny") => {
      setActioning(id);
      try {
        const res = await fetch(`${apiUrl}/v1/approvals/${id}/${action}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          fetchApprovals();
        }
      } finally {
        setActioning(null);
      }
    },
    [apiUrl, fetchApprovals],
  );

  const filtered = filter === "all" ? approvals : approvals.filter((a) => a.status === filter);

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Approvals</h1>
          <p className="text-sm text-muted-foreground">
            Pending access requests that need your approval
          </p>
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="denied">Denied</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Credential</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Delivery Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No approvals</div>
                    <div>
                      {filter === "all" ? "No access requests yet." : `No ${filter} requests.`}
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-medium">
                    {entry.credentialName ?? entry.credentialId}
                  </TableCell>
                  <TableCell>{entry.agentName ?? entry.agentId}</TableCell>
                  <TableCell className="text-muted-foreground">{entry.deliveryMode}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[entry.status]}>{entry.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(entry.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(entry.expiresAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {entry.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleAction(entry.id, "approve")}
                          disabled={actioning === entry.id}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleAction(entry.id, "deny")}
                          disabled={actioning === entry.id}
                        >
                          Deny
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">--</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
