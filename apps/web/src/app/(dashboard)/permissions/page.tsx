"use client";

import {
  type Agent,
  CAPABILITIES,
  type Capability,
  type ItemSummary,
  type Permission,
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
import { permissionFilterParsers } from "@/lib/query-state";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";

const CAPABILITY_LABELS: Record<Capability, string> = {
  read_ciphertext: "Read ciphertext",
  reveal_plaintext: "Reveal plaintext",
  mount_env: "Mount as env var",
  mount_file: "Mount as file",
  use_without_reveal: "Use without reveal",
};

export default function PermissionsPage(): React.ReactElement {
  const queryClient = useQueryClient();
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedCapability, setSelectedCapability] = useState<Capability>("mount_env");
  const [{ agent: filterAgent, item: filterItem }, setPermissionFilters] =
    useQueryStates(permissionFilterParsers);
  const [error, setError] = useState("");

  const permissionsQuery = useQuery({
    queryKey: dashboardQueryKeys.permissions(),
    queryFn: () => browserTrpcClient.permissions.list.query({}),
  });
  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.agents(),
    queryFn: () => browserTrpcClient.agents.list.query(),
  });
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.items(),
    queryFn: () => browserTrpcClient.items.list.query(),
  });
  const createPermission = useMutation({
    mutationFn: (input: { agentId: string; itemId: string; capability: Capability }) =>
      browserTrpcClient.permissions.create.mutate(input),
    onSuccess: async () => {
      setSelectedAgent("");
      setSelectedItem("");
      setError("");
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.permissions(),
      });
    },
  });
  const revokePermission = useMutation({
    mutationFn: ({ permissionId }: { permissionId: string }) =>
      browserTrpcClient.permissions.revoke.mutate({ permissionId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.permissions(),
      });
    },
  });

  const permissions = permissionsQuery.data?.permissions ?? [];
  const agents = agentsQuery.data?.agents ?? [];
  const items = itemsQuery.data?.items ?? [];
  const loading = permissionsQuery.isPending || agentsQuery.isPending || itemsQuery.isPending;

  const agentNames = useMemo<Map<string, string>>(
    () => new Map(agents.map((agent: Agent) => [agent.id, agent.name])),
    [agents],
  );

  async function handleCreatePermission(): Promise<void> {
    if (!selectedAgent || !selectedItem) {
      return;
    }

    try {
      await createPermission.mutateAsync({
        agentId: selectedAgent,
        itemId: selectedItem,
        capability: selectedCapability,
      });
    } catch (mutationError) {
      setError(getClientErrorMessage(mutationError, "Failed to create permission"));
    }
  }

  async function handleRevoke(permissionId: string): Promise<void> {
    if (!confirm("Revoke this permission?")) {
      return;
    }

    await revokePermission.mutateAsync({ permissionId });
  }

  const filtered = permissions.filter((permission: Permission) => {
    if (filterAgent !== "all" && permission.agentId !== filterAgent) return false;
    if (filterItem !== "all" && permission.itemId !== filterItem) return false;
    return true;
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Permissions</h1>
        <p className="text-sm text-muted-foreground">Manage which agents can access which items</p>
      </div>

      <div className="space-y-3 rounded-lg border border-border p-5">
        <div className="text-sm font-semibold">Create permission</div>
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Agent</label>
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger>
                <SelectValue placeholder="Select agent..." />
              </SelectTrigger>
              <SelectContent>
                {agents
                  .filter((agent: Agent) => agent.enabled && agent.revokedAt === null)
                  .map((agent: Agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
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
                {items.map((item: ItemSummary) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.id}
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
            onClick={handleCreatePermission}
            disabled={!selectedAgent || !selectedItem || createPermission.isPending}
          >
            {createPermission.isPending ? "Creating..." : "Create permission"}
          </Button>
        </div>
      </div>

      <div className="flex gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Filter by agent</label>
          <Select
            value={filterAgent}
            onValueChange={(value) => void setPermissionFilters({ agent: value })}
          >
            <SelectTrigger className="h-[28px] w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All agents</SelectItem>
              {agents.map((agent: Agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Filter by item</label>
          <Select
            value={filterItem}
            onValueChange={(value) => void setPermissionFilters({ item: value })}
          >
            <SelectTrigger className="h-[28px] w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All items</SelectItem>
              {items.map((item: ItemSummary) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {permissionsQuery.error || agentsQuery.error || itemsQuery.error ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-red-700">
                  {getClientErrorMessage(
                    permissionsQuery.error ?? agentsQuery.error ?? itemsQuery.error,
                    "Failed to load permissions",
                  )}
                </TableCell>
              </TableRow>
            ) : loading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                  <div className="space-y-2">
                    <div className="font-medium text-foreground">No permissions</div>
                    <div>Create a permission to allow an agent to access an item.</div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((permission: Permission) => (
                <TableRow key={permission.id}>
                  <TableCell className="font-medium">
                    {agentNames.get(permission.agentId) ?? permission.agentId}
                  </TableCell>
                  <TableCell>{permission.itemId}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {CAPABILITY_LABELS[permission.capability] ?? permission.capability}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(permission.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={revokePermission.isPending}
                      onClick={() => handleRevoke(permission.id)}
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
