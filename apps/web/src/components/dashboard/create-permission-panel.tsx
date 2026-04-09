"use client";

import { type Agent, CAPABILITIES, type Capability, type ItemSummary } from "@abadge/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { resolveItemLabel, useItemLabels } from "@/lib/use-item-labels";

const CAPABILITY_LABELS: Record<Capability, string> = {
  read_ciphertext: "Read ciphertext",
  reveal_plaintext: "Reveal plaintext",
  mount_env: "Mount as env var",
  mount_file: "Mount as file",
};

interface CreatePermissionPanelViewProps {
  formId: string;
  selectedAgent: string;
  selectedItem: string;
  selectedCapability: Capability;
  optionsLoading: boolean;
  agentOptions: SearchableSelectOption[];
  itemOptions: SearchableSelectOption[];
  onAgentChange: (value: string) => void;
  onItemChange: (value: string) => void;
  onCapabilityChange: (value: Capability) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

export function CreatePermissionPanelView({
  formId,
  selectedAgent,
  selectedItem,
  selectedCapability,
  optionsLoading,
  agentOptions,
  itemOptions,
  onAgentChange,
  onItemChange,
  onCapabilityChange,
  onSubmit,
}: CreatePermissionPanelViewProps): React.ReactElement {
  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <LabelLike>Agent</LabelLike>
          <SearchableSelect
            options={agentOptions}
            value={selectedAgent}
            onValueChange={onAgentChange}
            placeholder={optionsLoading ? "Loading agents..." : "Select agent..."}
            searchPlaceholder="Search agents..."
            emptyText="No agents found."
            triggerClassName="w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <LabelLike>Item</LabelLike>
          <SearchableSelect
            options={itemOptions}
            value={selectedItem}
            onValueChange={onItemChange}
            placeholder={optionsLoading ? "Loading items..." : "Select item..."}
            searchPlaceholder="Search items..."
            emptyText="No items found."
            triggerClassName="w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <LabelLike>Capability</LabelLike>
          <Select
            value={selectedCapability}
            onValueChange={(value) => onCapabilityChange(value as Capability)}
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
    </form>
  );
}

function LabelLike({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="text-sm font-medium">{children}</div>;
}

interface CreatePermissionPanelProps {
  open: boolean;
  onClose: () => void;
}

export function CreatePermissionPanel({
  open,
  onClose,
}: CreatePermissionPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const formId = useId();
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedCapability, setSelectedCapability] = useState<Capability>("mount_env");

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
      setSelectedCapability("mount_env");
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.permissions(),
      });
      toast.success("Permission created.");
      handleClose();
    },
  });

  const agents = agentsQuery.data?.agents ?? [];
  const items = itemsQuery.data?.items ?? [];
  const { labelMap } = useItemLabels(items);
  const optionsLoading = agentsQuery.isPending || itemsQuery.isPending;

  const activeAgentOptions = useMemo<SearchableSelectOption[]>(
    () =>
      agents
        .filter((agent: Agent) => agent.enabled && agent.revokedAt === null)
        .sort((a: Agent, b: Agent) => a.name.localeCompare(b.name))
        .map((agent: Agent) => ({ value: agent.id, label: agent.name })),
    [agents],
  );

  const itemOptions = useMemo<SearchableSelectOption[]>(
    () =>
      items
        .sort(
          (a: ItemSummary, b: ItemSummary) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .map((item: ItemSummary) => ({
          value: item.id,
          label: resolveItemLabel(item.id, labelMap, item.storageMode),
        })),
    [items, labelMap],
  );

  function handleClose(): void {
    setSelectedAgent("");
    setSelectedItem("");
    setSelectedCapability("mount_env");
    onClose();
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

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
      toast.error(getClientErrorMessage(mutationError, "Failed to create permission"));
    }
  }

  const queryError = agentsQuery.error ?? itemsQuery.error;
  const queryErrorMessage = queryError
    ? getClientErrorMessage(queryError, "Failed to load form options")
    : "";
  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleClose}>
        Cancel
      </Button>
      <Button
        form={formId}
        type="submit"
        size="sm"
        disabled={!selectedAgent || !selectedItem || createPermission.isPending || optionsLoading}
      >
        {createPermission.isPending ? "Creating..." : "Create permission"}
      </Button>
    </div>
  );

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleClose();
        }
      }}
      title="Create permission"
      description="Grant an agent access to an item with a specific capability."
      footer={footer}
      contentClassName="sm:max-w-3xl"
    >
      <CreatePermissionPanelView
        formId={formId}
        selectedAgent={selectedAgent}
        selectedItem={selectedItem}
        selectedCapability={selectedCapability}
        optionsLoading={optionsLoading}
        agentOptions={activeAgentOptions}
        itemOptions={itemOptions}
        onAgentChange={setSelectedAgent}
        onItemChange={setSelectedItem}
        onCapabilityChange={setSelectedCapability}
        onSubmit={(event) => {
          if (queryErrorMessage) {
            event.preventDefault();
            toast.error(queryErrorMessage);
            return;
          }

          void handleSubmit(event);
        }}
      />
    </ResponsiveOverlay>
  );
}
