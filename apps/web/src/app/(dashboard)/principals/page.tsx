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

interface Principal {
  id: string;
  name: string | null;
  kind: string;
  locality: string | null;
  prefix: string | null;
  enabled: boolean | null;
  lastRequest: string | null;
  createdAt: string;
}

function PrincipalRow({
  principal,
  onToggleActive,
  onDelete,
}: {
  principal: Principal;
  onToggleActive: (p: Principal) => void;
  onDelete: (id: string) => void;
}): React.ReactElement {
  return (
    <TableRow>
      <TableCell className="font-medium">{principal.name ?? "Unnamed"}</TableCell>
      <TableCell>
        <Badge variant="secondary">{principal.kind}</Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">{principal.locality ?? "\u2014"}</TableCell>
      <TableCell>
        {principal.prefix ? (
          <code className="text-xs bg-neutral-100 px-1.5 py-0.5 rounded font-mono">
            {principal.prefix}
          </code>
        ) : (
          <span className="text-muted-foreground">{"\u2014"}</span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant={principal.enabled ? "success" : "destructive"}>
          {principal.enabled ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {principal.lastRequest ? formatRelativeTime(principal.lastRequest) : "Never"}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatRelativeTime(principal.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onToggleActive(principal)}>
            {principal.enabled ? "Disable" : "Enable"}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => onDelete(principal.id)}>
            Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function PrincipalsPage(): React.ReactElement {
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [loading, setLoading] = useState(true);

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchPrincipals = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/v1/principals`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPrincipals(Array.isArray(data) ? data : []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrincipals();
  }, [fetchPrincipals]);

  async function handleToggleActive(principal: Principal): Promise<void> {
    await fetch(`${apiUrl}/v1/principals/${principal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ enabled: !principal.enabled }),
    });
    fetchPrincipals();
  }

  async function handleDelete(id: string): Promise<void> {
    if (!confirm("Delete this principal? All grants will be revoked.")) return;
    await fetch(`${apiUrl}/v1/principals/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    fetchPrincipals();
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Principals</h1>
          <p className="text-sm text-muted-foreground">
            Agents and services that can access your vault
          </p>
        </div>
        <Button size="sm" asChild>
          <Link href="/principals/new">Register principal</Link>
        </Button>
      </div>

      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Locality</TableHead>
              <TableHead>Key prefix</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : principals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No principals registered</div>
                    <div>
                      <Link href="/principals/new" className="text-link hover:underline">
                        Register your first principal
                      </Link>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              principals.map((p) => (
                <PrincipalRow
                  key={p.id}
                  principal={p}
                  onToggleActive={handleToggleActive}
                  onDelete={handleDelete}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
