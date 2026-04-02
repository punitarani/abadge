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

interface Grant {
  principalId: string;
  itemId: string;
  grantedAt: string;
  grantedBy: string;
  principalName: string | null;
  principalEnabled: boolean | null;
  itemName: string | null;
}

interface PrincipalEntry {
  id: string;
  name: string | null;
  enabled: boolean | null;
}

interface ItemEntry {
  id: string;
  name: string;
}

async function readJsonArrayIfOk(res: Response): Promise<unknown[]> {
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export default function GrantsPage(): React.ReactElement {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [principals, setPrincipals] = useState<PrincipalEntry[]>([]);
  const [items, setItems] = useState<ItemEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [granting, setGranting] = useState(false);

  const [selectedPrincipal, setSelectedPrincipal] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [filterPrincipal, setFilterPrincipal] = useState("all");
  const [filterItem, setFilterItem] = useState("all");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchData = useCallback(async () => {
    try {
      const [grantsRes, principalsRes, itemsRes] = await Promise.all([
        fetch(`${apiUrl}/v1/grants`, { credentials: "include" }),
        fetch(`${apiUrl}/v1/principals`, { credentials: "include" }),
        fetch(`${apiUrl}/v1/items`, { credentials: "include" }),
      ]);

      const [grantsData, principalsData, itemsData] = await Promise.all([
        readJsonArrayIfOk(grantsRes),
        readJsonArrayIfOk(principalsRes),
        readJsonArrayIfOk(itemsRes),
      ]);
      setGrants(grantsData as Grant[]);
      setPrincipals(principalsData as PrincipalEntry[]);
      setItems(itemsData as ItemEntry[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleGrant(): Promise<void> {
    if (!selectedPrincipal || !selectedItem) return;
    setGranting(true);
    try {
      await fetch(`${apiUrl}/v1/grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ principalId: selectedPrincipal, itemId: selectedItem }),
      });
      setSelectedPrincipal("");
      setSelectedItem("");
      fetchData();
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(principalId: string, itemId: string): Promise<void> {
    if (!confirm("Revoke this grant?")) return;
    await fetch(`${apiUrl}/v1/grants`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ principalId, itemId }),
    });
    fetchData();
  }

  const filtered = grants.filter((g) => {
    if (filterPrincipal !== "all" && g.principalId !== filterPrincipal) return false;
    if (filterItem !== "all" && g.itemId !== filterItem) return false;
    return true;
  });

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-lg font-semibold">Grants</h1>
        <p className="text-sm text-muted-foreground">
          Manage which principals can access which items
        </p>
      </div>

      {/* Create grant */}
      <div className="border border-border rounded-lg p-5 space-y-3">
        <div className="text-sm font-semibold">Create grant</div>
        <div className="flex gap-3 items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Principal</label>
            <Select value={selectedPrincipal} onValueChange={setSelectedPrincipal}>
              <SelectTrigger>
                <SelectValue placeholder="Select principal..." />
              </SelectTrigger>
              <SelectContent>
                {principals
                  .filter((p) => p.enabled)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name ?? "Unnamed"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Item</label>
            <Select value={selectedItem} onValueChange={setSelectedItem}>
              <SelectTrigger>
                <SelectValue placeholder="Select item..." />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={handleGrant}
            disabled={!selectedPrincipal || !selectedItem || granting}
          >
            {granting ? "Granting..." : "Grant access"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Filter by principal</label>
          <Select value={filterPrincipal} onValueChange={setFilterPrincipal}>
            <SelectTrigger className="w-[180px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All principals</SelectItem>
              {principals.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? "Unnamed"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Filter by item</label>
          <Select value={filterItem} onValueChange={setFilterItem}>
            <SelectTrigger className="w-[180px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All items</SelectItem>
              {items.map((i) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Grants table */}
      <div className="border border-border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Principal</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Granted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No grants</div>
                    <div>Create a grant to allow a principal to access an item.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((g) => (
                <TableRow key={`${g.principalId}-${g.itemId}`}>
                  <TableCell className="font-medium">{g.principalName ?? "Unnamed"}</TableCell>
                  <TableCell>{g.itemName ?? g.itemId}</TableCell>
                  <TableCell>
                    <Badge variant={g.principalEnabled ? "success" : "destructive"}>
                      {g.principalEnabled ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(g.grantedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleRevoke(g.principalId, g.itemId)}
                    >
                      Revoke
                    </Button>
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
