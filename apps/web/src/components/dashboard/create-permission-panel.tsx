"use client";

import {
  type Agent,
  type AgentLocality,
  CAPABILITIES,
  type Capability,
  type CreatePermissionInput,
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
    constraint: "local only · ZK only",
  },
  reveal_plaintext: {
    label: "Reveal plaintext",
    description: "Server decrypts and returns the field value",
    constraint: "all agents · all storage",
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
  alreadyGranted: boolean;
  onToggle: () => void;
}

function CapabilityCard({
  capability,
  selected,
  disabled,
  alreadyGranted,
  onToggle,
}: CapabilityCardProps): React.ReactElement {
  const meta = CAPABILITY_META[capability];
  const trailingTag = alreadyGranted ? "already granted" : meta.constraint;

  return (
    // biome-ignore lint/a11y/useSemanticElements: rich card layout (label + description + constraint chip) can't fit inside a native input; ARIA checkbox role is the standard pattern for clickable toggle cards.
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
        selected && "border-foreground bg-accent",
        !selected && !disabled && "border-border hover:border-foreground/40",
        disabled && "cursor-not-allowed border-border opacity-40",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            aria-hidden="true"
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded border",
              selected ? "border-foreground bg-foreground text-background" : "border-border",
            )}
          >
            {selected ? "✓" : ""}
          </span>
          {meta.label}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {trailingTag}
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
  selectedCapabilities: ReadonlySet<Capability>;
  alreadyGrantedCapabilities: ReadonlySet<Capability>;
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
  onCapabilityToggle: (value: Capability) => void;
  onExpiresAtChange: (value: string) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

export function CreatePermissionPanelView({
  formId,
  selectedAgent,
  selectedItem,
  selectedCapabilities,
  alreadyGrantedCapabilities,
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
  onCapabilityToggle,
  onExpiresAtChange,
  onSubmit,
}: CreatePermissionPanelViewProps): React.ReactElement {
  const previewVisible = selectedAgent && selectedItem && selectedCapabilities.size > 0;

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
          <LabelLike>Capabilities</LabelLike>
          {incompatibleMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {incompatibleMessage}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {CAPABILITIES.map((cap) => {
                const allowedByMatrix = allowedCapabilities.includes(cap);
                const alreadyGranted = alreadyGrantedCapabilities.has(cap);
                return (
                  <CapabilityCard
                    key={cap}
                    capability={cap}
                    selected={selectedCapabilities.has(cap)}
                    disabled={!allowedByMatrix || alreadyGranted}
                    alreadyGranted={alreadyGranted && allowedByMatrix}
                    onToggle={() => onCapabilityToggle(cap)}
                  />
                );
              })}
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
      {previewVisible && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-medium">{agentName}</span> can{" "}
          <span className="inline-flex flex-wrap gap-1">
            {CAPABILITIES.filter((cap) => selectedCapabilities.has(cap)).map((cap) => (
              <span
                key={cap}
                className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs dark:bg-amber-900/40"
              >
                {cap}
              </span>
            ))}
          </span>{" "}
          on <span className="font-medium">{itemLabel}</span>
          {" · "}
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
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<Capability>>(
    () => new Set(),
  );
  const [expiresAt, setExpiresAt] = useState("");

  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.agents.list.query(),
  });
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.items.list.query(),
  });

  // Existing grants on this exact (agent, item) pair — drives the
  // "already granted" disabled state on each capability checkbox.
  const existingPairQuery = useQuery({
    queryKey: ["permissions", "pair", activeOrgId ?? "", selectedAgent, selectedItem],
    queryFn: () =>
      browserTrpcClient.permissions.list.query({
        agentId: selectedAgent,
        itemId: selectedItem,
      }),
    enabled: Boolean(selectedAgent && selectedItem),
  });

  // Use the canonical SDK input type so the non-empty-tuple invariant
  // (`readonly [Capability, ...Capability[]]`) the tRPC procedure requires is
  // enforced at compile time rather than at the server-side schema check.
  const createPermission = useMutation({
    mutationFn: (input: CreatePermissionInput) =>
      browserTrpcClient.permissions.create.mutate(input),
    onSuccess: async (result) => {
      const count = result.permissions.length;
      resetForm();
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgPermissions(activeOrgId ?? ""),
      });
      toast.success(`Granted ${count} ${count === 1 ? "capability" : "capabilities"}.`);
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

  const alreadyGrantedCapabilities = useMemo<Set<Capability>>(() => {
    const set = new Set<Capability>();
    for (const p of existingPairQuery.data?.permissions ?? []) {
      set.add(p.capability as Capability);
    }
    return set;
  }, [existingPairQuery.data]);

  function resetForm(): void {
    setSelectedAgent("");
    setSelectedItem("");
    setSelectedCapabilities(new Set());
    setExpiresAt("");
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  function handleAgentChange(value: string): void {
    setSelectedAgent(value);
    setSelectedCapabilities(new Set());
  }

  function handleItemChange(value: string): void {
    setSelectedItem(value);
    setSelectedCapabilities(new Set());
  }

  function handleCapabilityToggle(cap: Capability): void {
    setSelectedCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        next.delete(cap);
      } else {
        next.add(cap);
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (!selectedAgent || !selectedItem || selectedCapabilities.size === 0) {
      return;
    }

    // Stable order: emit in the canonical CAPABILITIES order so the audit
    // log reads the same way regardless of UI click order. The non-empty
    // guard above (`selectedCapabilities.size === 0` early return) makes this
    // cast safe — narrows to the `[Capability, ...Capability[]]` shape that
    // CreatePermissionInput requires.
    const capabilities = CAPABILITIES.filter((cap) => selectedCapabilities.has(cap)) as [
      Capability,
      ...Capability[],
    ];

    try {
      await createPermission.mutateAsync({
        agentId: selectedAgent,
        itemId: selectedItem,
        capabilities,
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
  const submitDisabled =
    !selectedAgent ||
    !selectedItem ||
    selectedCapabilities.size === 0 ||
    createPermission.isPending ||
    optionsLoading ||
    existingPairQuery.isPending;
  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleClose}>
        Cancel
      </Button>
      <Button form={formId} type="submit" size="sm" disabled={submitDisabled}>
        {createPermission.isPending
          ? "Granting..."
          : selectedCapabilities.size > 1
            ? `Grant ${selectedCapabilities.size} capabilities`
            : "Grant permission"}
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
      description="Grant an agent access to an item with one or more capabilities."
      footer={footer}
      contentClassName="sm:max-w-3xl"
    >
      <CreatePermissionPanelView
        formId={formId}
        selectedAgent={selectedAgent}
        selectedItem={selectedItem}
        selectedCapabilities={selectedCapabilities}
        alreadyGrantedCapabilities={alreadyGrantedCapabilities}
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
        onCapabilityToggle={handleCapabilityToggle}
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
