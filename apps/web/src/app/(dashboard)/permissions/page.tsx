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
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
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

function formatItemId(id: string): string {
  return `${id.slice(0, 8)}...`;
}

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

  const activeAgentOptions = useMemo<SearchableSelectOption[]>(
    () =>
      agents
        .filter((a: Agent) => a.enabled && a.revokedAt === null)
        .sort((a: Agent, b: Agent) => a.name.localeCompare(b.name))
        .map((a: Agent) => ({ value: a.id, label: a.name })),
    [agents],
  );

  const itemOptions = useMemo<SearchableSelectOption[]>(
    () =>
      items
        .sort(
          (a: ItemSummary, b: ItemSummary) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .map((item: ItemSummary) => ({ value: item.id, label: formatItemId(item.id) })),
    [items],
  );

  const agentFilterOptions = useMemo<SearchableSelectOption[]>(
    () =>
      [{ value: "all", label: "All agents" }].concat(
        agents
          .sort((a: Agent, b: Agent) => a.name.localeCompare(b.name))
          .map((a: Agent) => ({ value: a.id, label: a.name })),
      ),
    [agents],
  );

  const itemFilterOptions = useMemo<SearchableSelectOption[]>(
    () =>
      [{ value: "all", label: "All items" }].concat(
        items
          .sort(
            (a: ItemSummary, b: ItemSummary) =>
              new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )
          .map((item: ItemSummary) => ({ value: item.id, label: formatItemId(item.id) })),
      ),
    [items],
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
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Permissions</h1>
        <p className="text-sm text-muted-foreground">Manage which agents can access which items</p>
      </div>

      <div className="space-y-4 rounded-lg border border-border p-5">
        <div className="text-sm font-semibold">Create permission</div>
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Agent</label>
            <SearchableSelect
              options={activeAgentOptions}
              value={selectedAgent}
              onValueChange={setSelectedAgent}
              placeholder="Select agent..."
              searchPlaceholder="Search agents..."
              emptyText="No agents found."
              triggerClassName="w-full"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Item</label>
            <SearchableSelect
              options={itemOptions}
              value={selectedItem}
              onValueChange={setSelectedItem}
              placeholder="Select item..."
              searchPlaceholder="Search items..."
              emptyText="No items found."
              triggerClassName="w-full"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Capability</label>
            <Select
              value={selectedCapability}
              onValueChange={(value) => setSelectedCapability(value as Capability)}
            >
              <SelectTrigger className="w-full">
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
        </div>
        <div className="flex justify-end">
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
          <SearchableSelect
            options={agentFilterOptions}
            value={filterAgent}
            onValueChange={(value) => void setPermissionFilters({ agent: value })}
            searchPlaceholder="Search agents..."
            triggerClassName="h-[28px] w-[200px] text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Filter by item</label>
          <SearchableSelect
            options={itemFilterOptions}
            value={filterItem}
            onValueChange={(value) => void setPermissionFilters({ item: value })}
            searchPlaceholder="Search items..."
            triggerClassName="h-[28px] w-[200px] text-xs"
          />
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
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {formatItemId(permission.itemId)}
                  </TableCell>
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
