"use client";

import {
  type Agent,
  type AgentLocality,
  CANONICAL_CAPABILITIES,
  type Capability,
  type CreatePermissionInput,
  getAllowedCapabilities,
  type ItemSummary,
  type Profile,
  type StorageMode,
} from "@abadge/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { cn } from "@/lib/utils";
import { useOrgStore } from "@/stores/org-store";

// §REVAMP-PR5 (Task 9.3) — Surface only the canonical capabilities in
// the create-grant UI. Legacy capabilities (read_ciphertext / mount_*)
// are still accepted by the server for existing grants, but no new grant
// should be written under those names.
const CAPABILITY_META: Record<
  (typeof CANONICAL_CAPABILITIES)[number],
  { label: string; description: string; constraint: string }
> = {
  read: {
    label: "Read",
    description: "Read the secret (plaintext for server-managed, ciphertext for ZK)",
    constraint: "locality + storage checked at access time",
  },
  use: {
    label: "Use",
    description: "Use the secret via env var or file mount delivery",
    constraint: "local only",
  },
};

type TargetType = "item" | "profile";

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
  const meta = CAPABILITY_META[capability as keyof typeof CAPABILITY_META];
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
  targetType: TargetType;
  selectedAgent: string;
  selectedItem: string;
  selectedProfile: string;
  selectedCapabilities: ReadonlySet<Capability>;
  alreadyGrantedCapabilities: ReadonlySet<Capability>;
  optionsLoading: boolean;
  agentOptions: SearchableSelectOption[];
  itemOptions: SearchableSelectOption[];
  profileOptions: SearchableSelectOption[];
  allowedCapabilities: readonly Capability[];
  incompatibleMessage: string;
  agentName: string;
  targetLabel: string;
  expiresAt: string;
  onTargetTypeChange: (value: TargetType) => void;
  onAgentChange: (value: string) => void;
  onItemChange: (value: string) => void;
  onProfileChange: (value: string) => void;
  onCapabilityToggle: (value: Capability) => void;
  onExpiresAtChange: (value: string) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pure render component; branching mirrors the form's state machine (target type, incompatibility, preview). Splitting would create equally-complex props plumbing.
export function CreatePermissionPanelView({
  formId,
  targetType,
  selectedAgent,
  selectedItem,
  selectedProfile,
  selectedCapabilities,
  alreadyGrantedCapabilities,
  optionsLoading,
  agentOptions,
  itemOptions,
  profileOptions,
  allowedCapabilities,
  incompatibleMessage,
  agentName,
  targetLabel,
  expiresAt,
  onTargetTypeChange,
  onAgentChange,
  onItemChange,
  onProfileChange,
  onCapabilityToggle,
  onExpiresAtChange,
  onSubmit,
}: CreatePermissionPanelViewProps): React.ReactElement {
  const targetSelected = targetType === "item" ? selectedItem : selectedProfile;
  const previewVisible = selectedAgent && targetSelected && selectedCapabilities.size > 0;

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
          <LabelLike>Target</LabelLike>
          <div className="flex gap-2">
            <label
              className={cn(
                "flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                targetType === "item"
                  ? "border-foreground bg-accent"
                  : "border-border hover:border-foreground/40",
              )}
            >
              <input
                type="radio"
                name="grant-target-type"
                value="item"
                checked={targetType === "item"}
                onChange={() => onTargetTypeChange("item")}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <div className="font-medium">Single item</div>
                <p className="text-xs text-muted-foreground">Grant access to one credential.</p>
              </div>
            </label>
            <label
              className={cn(
                "flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                targetType === "profile"
                  ? "border-foreground bg-accent"
                  : "border-border hover:border-foreground/40",
              )}
            >
              <input
                type="radio"
                name="grant-target-type"
                value="profile"
                checked={targetType === "profile"}
                onChange={() => onTargetTypeChange("profile")}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <div className="font-medium">Entire profile</div>
                <p className="text-xs text-muted-foreground">
                  Grant access to every item in the profile, now and in the future.
                </p>
              </div>
            </label>
          </div>
        </div>

        {targetType === "item" ? (
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
        ) : (
          <div className="flex flex-col gap-1.5">
            <LabelLike>Profile</LabelLike>
            <SearchableSelect
              options={profileOptions}
              value={selectedProfile}
              onValueChange={onProfileChange}
              placeholder={optionsLoading ? "Loading profiles..." : "Select profile..."}
              searchPlaceholder="Search profiles..."
              emptyText="No profiles found."
              triggerClassName="w-full"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <LabelLike>Capabilities</LabelLike>
          {incompatibleMessage ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
              {incompatibleMessage}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {CANONICAL_CAPABILITIES.map((cap) => {
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
            {CANONICAL_CAPABILITIES.filter((cap) => selectedCapabilities.has(cap)).map((cap) => (
              <span
                key={cap}
                className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs dark:bg-amber-900/40"
              >
                {cap}
              </span>
            ))}
          </span>{" "}
          on{" "}
          <span className="font-medium">
            {targetType === "profile" ? "profile " : ""}
            {targetLabel}
          </span>
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrator component — branches are unavoidable (item vs profile target, multiple query states, blast-radius confirmation). Each branch is small and named; splitting would obscure the orchestration.
export function CreatePermissionPanel({
  open,
  onClose,
}: CreatePermissionPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const { activeOrgId } = useOrgStore();
  const formId = useId();
  const [targetType, setTargetType] = useState<TargetType>("item");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [selectedItem, setSelectedItem] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedCapabilities, setSelectedCapabilities] = useState<Set<Capability>>(
    () => new Set(),
  );
  const [expiresAt, setExpiresAt] = useState("");

  // Blast-radius confirmation for profile + read grants. We hold the
  // planned mutation input here so the user can review and either confirm
  // or cancel before any state mutation happens.
  const [pendingConfirmInput, setPendingConfirmInput] = useState<CreatePermissionInput | null>(
    null,
  );

  const agentsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgAgents(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.agents.list.query(),
  });
  const itemsQuery = useQuery({
    queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.items.list.query(),
  });
  const profilesQuery = useQuery({
    queryKey: dashboardQueryKeys.profiles(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.profiles.list.query({ orgId: activeOrgId ?? "" }),
    enabled: Boolean(activeOrgId),
  });

  // Existing grants on this exact (agent, target) pair — drives the
  // "already granted" disabled state on each capability checkbox.
  const existingPairQuery = useQuery({
    queryKey: [
      "permissions",
      "pair",
      activeOrgId ?? "",
      selectedAgent,
      targetType,
      targetType === "item" ? selectedItem : selectedProfile,
    ],
    queryFn: () =>
      browserTrpcClient.permissions.list.query({
        agentId: selectedAgent,
        ...(targetType === "item" ? { itemId: selectedItem } : { profileId: selectedProfile }),
      }),
    enabled: Boolean(selectedAgent && (targetType === "item" ? selectedItem : selectedProfile)),
  });

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
  const profilesList = profilesQuery.data?.profiles ?? [];
  const optionsLoading = agentsQuery.isPending || itemsQuery.isPending || profilesQuery.isPending;

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

  const profileOptions = useMemo<SearchableSelectOption[]>(
    () =>
      [...profilesList]
        .sort((a: Profile, b: Profile) => a.name.localeCompare(b.name))
        .map((profile: Profile) => ({
          value: profile.id,
          label: profile.externalId
            ? `${profile.name} (externalId: ${profile.externalId})`
            : profile.name,
        })),
    [profilesList],
  );

  const selectedAgentObj = useMemo(
    () => agents.find((a: Agent) => a.id === selectedAgent) ?? null,
    [agents, selectedAgent],
  );
  const selectedItemObj = useMemo(
    () => items.find((i: ItemSummary) => i.id === selectedItem) ?? null,
    [items, selectedItem],
  );
  const selectedProfileObj = useMemo(
    () => profilesList.find((p: Profile) => p.id === selectedProfile) ?? null,
    [profilesList, selectedProfile],
  );

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: enumerates the (agent locality, target type, storage mode) constraint matrix in one place. Server enforces the same matrix; splitting would just relocate the same branches.
  const { allowedCapabilities, incompatibleMessage } = useMemo(() => {
    if (!selectedAgentObj) {
      return {
        allowedCapabilities: CANONICAL_CAPABILITIES as readonly Capability[],
        incompatibleMessage: "",
      };
    }
    const locality = selectedAgentObj.locality as AgentLocality;

    if (targetType === "item") {
      if (!selectedItemObj) {
        return {
          allowedCapabilities: CANONICAL_CAPABILITIES as readonly Capability[],
          incompatibleMessage: "",
        };
      }
      const storageMode = selectedItemObj.storageMode as StorageMode;
      const allowed = getAllowedCapabilities(locality, storageMode);
      const canonicalAllowed = allowed.filter((c) =>
        (CANONICAL_CAPABILITIES as readonly Capability[]).includes(c),
      );
      if (canonicalAllowed.length === 0) {
        return {
          allowedCapabilities: [] as readonly Capability[],
          incompatibleMessage: "Remote agents cannot access zero-knowledge items.",
        };
      }
      return { allowedCapabilities: canonicalAllowed, incompatibleMessage: "" };
    }

    // Profile target. We compute the strict intersection of allowed
    // capabilities across every item currently in the profile, plus the
    // locality matrix on the agent. The server runs the same check at
    // grant-create time and rejects a violation with
    // INVALID_CAPABILITY_LOCALITY / INVALID_CAPABILITY_STORAGE.
    if (!selectedProfileObj) {
      return {
        allowedCapabilities: CANONICAL_CAPABILITIES as readonly Capability[],
        incompatibleMessage: "",
      };
    }
    const profileItems = items.filter((i: ItemSummary) => i.profileId === selectedProfile);
    const modes = new Set<StorageMode>(profileItems.map((i: ItemSummary) => i.storageMode));
    // If the profile has no items yet, we can't constrain by storage. Allow
    // both; the server's grant-create constraint runs on every item add.
    if (modes.size === 0) {
      // Local agents: both `read` and `use` are reachable. Remote agents:
      // only `read` is reachable, and only against server-managed items.
      const allowed: Capability[] = locality === "local" ? ["read", "use"] : ["read"];
      return { allowedCapabilities: allowed, incompatibleMessage: "" };
    }
    const intersection: Capability[] = (CANONICAL_CAPABILITIES as readonly Capability[]).filter(
      (cap) => {
        for (const mode of modes) {
          if (!getAllowedCapabilities(locality, mode).includes(cap)) return false;
        }
        return true;
      },
    );
    if (intersection.length === 0) {
      return {
        allowedCapabilities: [] as readonly Capability[],
        incompatibleMessage:
          "This agent cannot be granted any capability on this profile (locality + storage mismatch).",
      };
    }
    return { allowedCapabilities: intersection, incompatibleMessage: "" };
  }, [selectedAgentObj, selectedItemObj, selectedProfileObj, targetType, items, selectedProfile]);

  const alreadyGrantedCapabilities = useMemo<Set<Capability>>(() => {
    const set = new Set<Capability>();
    for (const p of existingPairQuery.data?.permissions ?? []) {
      set.add(p.capability as Capability);
    }
    return set;
  }, [existingPairQuery.data]);

  function resetForm(): void {
    setTargetType("item");
    setSelectedAgent("");
    setSelectedItem("");
    setSelectedProfile("");
    setSelectedCapabilities(new Set());
    setExpiresAt("");
    setPendingConfirmInput(null);
  }

  function handleClose(): void {
    resetForm();
    onClose();
  }

  function handleTargetTypeChange(value: TargetType): void {
    setTargetType(value);
    setSelectedItem("");
    setSelectedProfile("");
    setSelectedCapabilities(new Set());
  }

  function handleAgentChange(value: string): void {
    setSelectedAgent(value);
    setSelectedCapabilities(new Set());
  }

  function handleItemChange(value: string): void {
    setSelectedItem(value);
    setSelectedCapabilities(new Set());
  }

  function handleProfileChange(value: string): void {
    setSelectedProfile(value);
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pre-submit validation, payload shape selection (item vs profile), and blast-radius confirmation are intentionally co-located so the flow reads top-to-bottom.
  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (!selectedAgent || selectedCapabilities.size === 0) return;
    if (targetType === "item" && !selectedItem) return;
    if (targetType === "profile" && !selectedProfile) return;

    // Stable canonical order so audit log reads consistently regardless of
    // UI click order. The non-empty guard above narrows for the SDK input
    // type's `[Capability, ...Capability[]]` requirement.
    const capabilities = (CANONICAL_CAPABILITIES as readonly Capability[]).filter((cap) =>
      selectedCapabilities.has(cap),
    ) as [Capability, ...Capability[]];

    const input: CreatePermissionInput =
      targetType === "item"
        ? {
            agentId: selectedAgent,
            itemId: selectedItem,
            capabilities,
            expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          }
        : {
            agentId: selectedAgent,
            profileId: selectedProfile,
            capabilities,
            expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          };

    // Blast-radius confirmation for the highest-privilege grant shape.
    // Profile + `read` hands the agent the plaintext of every credential
    // currently in the profile and every credential added later.
    if (targetType === "profile" && capabilities.includes("read")) {
      setPendingConfirmInput(input);
      return;
    }

    await executeCreate(input);
  }

  async function executeCreate(input: CreatePermissionInput): Promise<void> {
    try {
      await createPermission.mutateAsync(input);
    } catch (mutationError) {
      toast.error(getClientErrorMessage(mutationError, "Failed to grant permission"));
    } finally {
      setPendingConfirmInput(null);
    }
  }

  const queryError = agentsQuery.error ?? itemsQuery.error ?? profilesQuery.error;
  const queryErrorMessage = queryError
    ? getClientErrorMessage(queryError, "Failed to load form options")
    : "";
  const targetSelected = targetType === "item" ? selectedItem : selectedProfile;
  const submitDisabled =
    !selectedAgent ||
    !targetSelected ||
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

  const profileLabel = selectedProfileObj?.name ?? "";

  return (
    <>
      <ResponsiveOverlay
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            handleClose();
          }
        }}
        title="Grant permission"
        description="Grant an agent access to a single item or every item in a profile."
        footer={footer}
        contentClassName="sm:max-w-3xl"
      >
        <CreatePermissionPanelView
          formId={formId}
          targetType={targetType}
          selectedAgent={selectedAgent}
          selectedItem={selectedItem}
          selectedProfile={selectedProfile}
          selectedCapabilities={selectedCapabilities}
          alreadyGrantedCapabilities={alreadyGrantedCapabilities}
          optionsLoading={optionsLoading}
          agentOptions={activeAgentOptions}
          itemOptions={itemOptions}
          profileOptions={profileOptions}
          allowedCapabilities={allowedCapabilities}
          incompatibleMessage={incompatibleMessage}
          agentName={selectedAgentObj?.name ?? ""}
          targetLabel={targetType === "item" ? (selectedItemObj?.label ?? "") : profileLabel}
          expiresAt={expiresAt}
          onTargetTypeChange={handleTargetTypeChange}
          onAgentChange={handleAgentChange}
          onItemChange={handleItemChange}
          onProfileChange={handleProfileChange}
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

      <Dialog
        open={pendingConfirmInput !== null}
        onOpenChange={(next) => {
          if (!next) setPendingConfirmInput(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant `read` on an entire profile?</DialogTitle>
            <DialogDescription>
              This grants the agent every credential currently and ever stored in this profile.
              Consider <span className="font-mono">use</span> instead — the agent invokes processes
              with the secret but never sees it.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <div>
              <span className="font-medium">{selectedAgentObj?.name ?? "Agent"}</span> → profile{" "}
              <span className="font-medium">{profileLabel}</span>
            </div>
            <div className="mt-1 text-xs">
              {profilesList.length > 0 && selectedProfileObj
                ? `Every item in this profile (${items.filter((i: ItemSummary) => i.profileId === selectedProfile).length} today, plus every item added later)`
                : "Every item added to this profile, now and in the future"}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingConfirmInput(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={createPermission.isPending}
              onClick={() => {
                if (pendingConfirmInput) void executeCreate(pendingConfirmInput);
              }}
            >
              {createPermission.isPending ? "Granting..." : "Grant anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
