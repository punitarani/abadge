"use client";

import {
  type Agent,
  type AgentLocality,
  CAPABILITIES,
  type Capability,
  getAllowedCapabilities,
  type ItemSummary,
  type StorageMode,
} from "@abadge/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { cn } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

const CAPABILITY_META: Record<
  Capability,
  { label: string; description: string; constraint: string }
> = {
  read_ciphertext: {
    label: "Read ciphertext",
    description: "Returns the encrypted blob for local decryption",
    constraint: "local only \u00b7 ZK only",
  },
  reveal_plaintext: {
    label: "Reveal plaintext",
    description: "Server decrypts and returns the field value",
    constraint: "all agents \u00b7 all storage",
  },
  mount_env: {
    label: "Mount as env var",
    description: "Injects secret as env var into a subprocess",
    constraint: "local only",
  },
  mount_file: {
    label: "Mount as file",
    description: "Writes secret to a temp file (0600), returns opaque mountId",
    constraint: "local only",
  },
};

function LabelLike({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="text-sm font-medium">{children}</div>;
}

interface CapabilityCardProps {
  capability: Capability;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function CapabilityCard({
  capability,
  selected,
  disabled,
  onSelect,
}: CapabilityCardProps): React.ReactElement {
  const meta = CAPABILITY_META[capability];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
        selected && "border-foreground bg-accent",
        !selected && !disabled && "border-border hover:border-foreground/40",
        disabled && "cursor-not-allowed border-border opacity-40",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{meta.label}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {meta.constraint}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{meta.description}</span>
    </button>
  );
}

interface CreatePermissionPanelViewProps {
  formId: string;
  selectedAgent: string;
  selectedItem: string;
  selectedCapability: Capability | "";
  optionsLoading: boolean;
  agentOptions: SearchableSelectOption[];
  itemOptions: SearchableSelectOption[];
  allowedCapabilities: readonly Capability[];
  incompatibleMessage: string;
  agentName: string;
  itemLabel: string;
  expiresAt: string;
  onAgentChange: (value: string) => void;
  onItemChange: (value: string) => void;
  onCapabilityChange: (value: Capability) => void;
  onExpiresAtChange: (value: string) => void;
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
  allowedCapabilities,
  incompatibleMessage,
  agentName,
  itemLabel,
  expiresAt,
  onAgentChange,
  onItemChange,
  onCapabilityChange,
  onExpiresAtChange,
  onSubmit,
}: CreatePermissionPanelViewProps): React.ReactElement {
  const allSelected = selectedAgent && selectedItem && selectedCapability;

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
          {incompatibleMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {incompatibleMessage}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {CAPABILITIES.map((cap) => (
                <CapabilityCard
                  key={cap}
                  capability={cap}
                  selected={selectedCapability === cap}
                  disabled={!allowedCapabilities.includes(cap)}
                  onSelect={() => onCapabilityChange(cap)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <LabelLike>Expiry</LabelLike>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => onExpiresAtChange(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              min={new Date().toISOString().split("T")[0]}
            />
            {expiresAt && (
              <button
                type="button"
                onClick={() => onExpiresAtChange("")}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear (no expiry)
              </button>
            )}
            {!expiresAt && (
              <span className="text-xs text-muted-foreground">No expiry (permanent)</span>
            )}
          </div>
        </div>
      </div>

      {/* Permission preview */}
      {allSelected && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-medium">{agentName}</span> can{" "}
          <span className="font-mono text-xs">{selectedCapability}</span> on{" "}
          <span className="font-medium">{itemLabel}</span>
          {" \u00b7 "}
          {expiresAt ? `expires ${expiresAt}` : "permanent"}
        </div>
      )}
    </form>
  );
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
  const { activeOrgId } = useOrgStore();
  const formId = useId();
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedCapability, setSelectedCapability] = useState<Capability | "">("");
  const [expiresAt, setExpiresAt] = useState("");

  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.agents.list.query(),
  });
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.items.list.query(),
  });
  const createPermission = useMutation({
    mutationFn: (input: {
      agentId: string;
      itemId: string;
      capability: Capability;
      expiresAt?: string;
    }) => browserTrpcClient.permissions.create.mutate(input),
    onSuccess: async () => {
      resetForm();
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgPermissions(activeOrgId ?? ""),
      });
      toast.success("Permission granted.");
      handleClose();
    },
  });

  const agents = agentsQuery.data?.agents ?? [];
  const items = itemsQuery.data?.items ?? [];
  const optionsLoading = agentsQuery.isPending || itemsQuery.isPending;

  const activeAgentOptions = useMemo<SearchableSelectOption[]>(
    () =>
      agents
        .filter((agent: Agent) => agent.enabled && agent.revokedAt === null)
        .sort((a: Agent, b: Agent) => a.name.localeCompare(b.name))
        .map((agent: Agent) => ({
          value: agent.id,
          label: `${agent.name} (${agent.kind === "local_cli" ? "CLI" : agent.kind === "local_mcp" ? "MCP" : "Remote"})`,
        })),
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
          label: `${item.label} (${item.storageMode === "zero_knowledge" ? "ZK" : "server"})`,
        })),
    [items],
  );

  const selectedAgentObj = useMemo(
    () => agents.find((a: Agent) => a.id === selectedAgent) ?? null,
    [agents, selectedAgent],
  );
  const selectedItemObj = useMemo(
    () => items.find((i: ItemSummary) => i.id === selectedItem) ?? null,
    [items, selectedItem],
  );

  const { allowedCapabilities, incompatibleMessage } = useMemo(() => {
    if (!selectedAgentObj || !selectedItemObj) {
      return {
        allowedCapabilities: CAPABILITIES as readonly Capability[],
        incompatibleMessage: "",
      };
    }

    const locality = selectedAgentObj.locality as AgentLocality;
    const storageMode = selectedItemObj.storageMode as StorageMode;
    const allowed = getAllowedCapabilities(locality, storageMode);

    if (allowed.length === 0) {
      return {
        allowedCapabilities: [] as readonly Capability[],
        incompatibleMessage: "Remote agents cannot access zero-knowledge items.",
      };
    }

    return { allowedCapabilities: allowed, incompatibleMessage: "" };
  }, [selectedAgentObj, selectedItemObj]);

  function resetForm(): void {
    setSelectedAgent("");
    setSelectedItem("");
    setSelectedCapability("");
    setExpiresAt("");
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  function handleAgentChange(value: string): void {
    setSelectedAgent(value);
    setSelectedCapability("");
  }

  function handleItemChange(value: string): void {
    setSelectedItem(value);
    setSelectedCapability("");
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (!selectedAgent || !selectedItem || !selectedCapability) {
      return;
    }

    try {
      await createPermission.mutateAsync({
        agentId: selectedAgent,
        itemId: selectedItem,
        capability: selectedCapability,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
    } catch (mutationError) {
      toast.error(getClientErrorMessage(mutationError, "Failed to grant permission"));
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
        disabled={
          !selectedAgent ||
          !selectedItem ||
          !selectedCapability ||
          createPermission.isPending ||
          optionsLoading
        }
      >
        {createPermission.isPending ? "Granting..." : "Grant permission"}
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
      title="Grant permission"
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
        allowedCapabilities={allowedCapabilities}
        incompatibleMessage={incompatibleMessage}
        agentName={selectedAgentObj?.name ?? ""}
        itemLabel={selectedItemObj?.label ?? ""}
        expiresAt={expiresAt}
        onAgentChange={handleAgentChange}
        onItemChange={handleItemChange}
        onCapabilityChange={setSelectedCapability}
        onExpiresAtChange={setExpiresAt}
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
