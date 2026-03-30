"use client";

import { clientEnv } from "@abadge/env/client";
import Link from "next/link";
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
import { formatRelativeTime } from "@/lib/utils";

interface PolicyRule {
  type: string;
  allowedModes?: string[];
  allowedEnvironments?: string[];
  requiresApprovalAbove?: string;
  allowedDestinations?: string[];
  blockedDestinations?: string[];
  maxTtlSeconds?: number;
}

interface PolicyEntry {
  id: string;
  name: string;
  credentialId: string | null;
  rules: PolicyRule[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  credentialName?: string;
}

export default function PoliciesPage(): React.ReactElement {
  const [policies, setPolicies] = useState<PolicyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/v1/policies`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPolicies(data.policies as PolicyEntry[]);
      }
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const handleToggle = useCallback(
    async (policy: PolicyEntry) => {
      await fetch(`${apiUrl}/v1/policies/${policy.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: !policy.enabled }),
      });
      fetchPolicies();
    },
    [apiUrl, fetchPolicies],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this policy? This cannot be undone.")) return;
      const res = await fetch(`${apiUrl}/v1/policies/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        fetchPolicies();
      }
    },
    [apiUrl, fetchPolicies],
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Policies</h1>
          <p className="text-sm text-muted-foreground">
            Define rules that govern how credentials can be accessed
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/policies/new">Create policy</Link>
        </Button>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Credential</TableHead>
              <TableHead>Rules</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : policies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No policies yet</div>
                    <div>Create your first policy to control credential access.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              policies.map((policy) => (
                <TableRow key={policy.id}>
                  <TableCell className="font-medium">{policy.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {policy.credentialName ??
                      (policy.credentialId ? policy.credentialId : "Global")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {policy.rules.length} {policy.rules.length === 1 ? "rule" : "rules"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={policy.enabled ? "success" : "secondary"}>
                      {policy.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(policy.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleToggle(policy)}>
                        {policy.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(policy.id)}
                      >
                        Delete
                      </Button>
                    </div>
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
