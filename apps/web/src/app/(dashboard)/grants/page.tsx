"use client";

import {
  CAPABILITIES,
  type Capability,
  type Grant,
  type ItemSummary,
  type Principal,
} from "@abadge/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { dashboardQueryKeys } from "@/lib/query-keys";
import { grantFilterParsers } from "@/lib/query-state";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";

const CAPABILITY_LABELS: Record<Capability, string> = {
  read_ciphertext: "Read ciphertext",
  reveal_plaintext: "Reveal plaintext",
  mount_env: "Mount as env var",
  mount_file: "Mount as file",
  use_without_reveal: "Use without reveal",
};

export default function GrantsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [selectedPrincipal, setSelectedPrincipal] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedCapability, setSelectedCapability] = useState<Capability>("mount_env");
  const [{ principal: filterPrincipal, item: filterItem }, setGrantFilters] =
    useQueryStates(grantFilterParsers);
  const [error, setError] = useState("");

  const grantsQuery = useQuery({
    queryKey: dashboardQueryKeys.grants(),
    queryFn: () => browserTrpcClient.grants.list.query({}),
  });
  const principalsQuery = useQuery({
    queryKey: dashboardQueryKeys.principals(),
    queryFn: () => browserTrpcClient.principals.list.query(),
  });
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.items(),
    queryFn: () => browserTrpcClient.items.list.query(),
  });
  const createGrant = useMutation({
    mutationFn: (input: { principalId: string; itemId: string; capability: Capability }) =>
      browserTrpcClient.grants.create.mutate(input),
    onSuccess: async () => {
      setSelectedPrincipal("");
      setSelectedItem("");
      setError("");
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.grants(),
      });
    },
  });
  const revokeGrant = useMutation({
    mutationFn: ({ grantId }: { grantId: string }) =>
      browserTrpcClient.grants.revoke.mutate({ grantId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.grants(),
      });
    },
  });

  const grants = grantsQuery.data?.grants ?? [];
  const principals = principalsQuery.data?.principals ?? [];
  const items = itemsQuery.data?.items ?? [];
  const loading = grantsQuery.isPending || principalsQuery.isPending || itemsQuery.isPending;

  const principalNames = useMemo<Map<string, string>>(
    () => new Map(principals.map((principal: Principal) => [principal.id, principal.name])),
    [principals],
  );

  async function handleGrant(): Promise<void> {
    if (!selectedPrincipal || !selectedItem) {
      return;
    }

    try {
      await createGrant.mutateAsync({
        principalId: selectedPrincipal,
        itemId: selectedItem,
        capability: selectedCapability,
      });
    } catch (mutationError) {
      setError(getClientErrorMessage(mutationError, "Failed to create grant"));
    }
  }

  async function handleRevoke(grantId: string): Promise<void> {
    if (!confirm("Revoke this grant?")) {
      return;
    }

    await revokeGrant.mutateAsync({ grantId });
  }

  const filtered = grants.filter((g: Grant) => {
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
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <div className="flex gap-3 items-end">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Principal</label>
            <Select value={selectedPrincipal} onValueChange={setSelectedPrincipal}>
              <SelectTrigger>
                <SelectValue placeholder="Select principal..." />
              </SelectTrigger>
              <SelectContent>
                {principals
                  .filter((p: Principal) => p.enabled && p.revokedAt === null)
                  .map((p: Principal) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
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
                {items.map((i: ItemSummary) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Capability</label>
            <Select
              value={selectedCapability}
              onValueChange={(value) => setSelectedCapability(value as Capability)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAPABILITIES.map((capability) => (
                  <SelectItem key={capability} value={capability}>
                    {CAPABILITY_LABELS[capability]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            onClick={handleGrant}
            disabled={!selectedPrincipal || !selectedItem || createGrant.isPending}
          >
            {createGrant.isPending ? "Granting..." : "Grant access"}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Filter by principal</label>
          <Select
            value={filterPrincipal}
            onValueChange={(value) => void setGrantFilters({ principal: value })}
          >
            <SelectTrigger className="w-[180px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All principals</SelectItem>
              {principals.map((p: Principal) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Filter by item</label>
          <Select
            value={filterItem}
            onValueChange={(value) => void setGrantFilters({ item: value })}
          >
            <SelectTrigger className="w-[180px] h-[28px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All items</SelectItem>
              {items.map((i: ItemSummary) => (
                <SelectItem key={i.id} value={i.id}>
                  {i.id}
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
            {grantsQuery.error || principalsQuery.error || itemsQuery.error ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-red-700">
                  {getClientErrorMessage(
                    grantsQuery.error ?? principalsQuery.error ?? itemsQuery.error,
                    "Failed to load grants",
                  )}
                </TableCell>
              </TableRow>
            ) : loading ? (
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
              filtered.map((g: Grant) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">
                    {principalNames.get(g.principalId) ?? g.principalId}
                  </TableCell>
                  <TableCell>{g.itemId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {CAPABILITY_LABELS[g.capability] ?? g.capability}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(g.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={revokeGrant.isPending}
                      onClick={() => handleRevoke(g.id)}
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
