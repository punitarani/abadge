"use client";

import type { ItemKind, Profile } from "@abadge/core";
import { Warning } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  buildFieldsForKind,
  ItemFormFields,
  KindFieldEditor,
} from "@/components/dashboard/item-form-fields";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { encryptItemForProfile } from "@/lib/crypto-client";
import { defaultProfileId, profileOptionLabel } from "@/lib/profile-select";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useVault } from "@/lib/vault-context";
import { useOrgStore } from "@/stores/org-store";

export type StorageMode = "zero_knowledge" | "server_managed";

/* ---- View ---- */

export interface CreateItemPanelViewProps {
  formId: string;
  name: string;
  kind: ItemKind;
  /** Profiles the item can be created in (the org's profiles). */
  profiles: Profile[];
  /** True while the profile list is being loaded for the open panel. */
  profilesLoading: boolean;
  /** Currently selected profile id (its storage mode drives the crypto path). */
  selectedProfileId: string;
  /** Derived from the selected profile; used for the ZK note. */
  storageMode: StorageMode;
  fieldValues: Record<string, string>;
  onNameChange: (value: string) => void;
  onKindChange: (kind: ItemKind) => void;
  onSelectProfile: (profileId: string) => void;
  onFieldsChange: (fields: Record<string, string>) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

export function CreateItemPanelView({
  formId,
  name,
  kind,
  profiles,
  profilesLoading,
  selectedProfileId,
  storageMode,
  fieldValues,
  onNameChange,
  onKindChange,
  onSelectProfile,
  onFieldsChange,
  onSubmit,
}: CreateItemPanelViewProps): React.ReactElement {
  const profileOptions = useMemo<SearchableSelectOption[]>(
    () =>
      [...profiles]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ value: p.id, label: profileOptionLabel(p) })),
    [profiles],
  );
  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;

  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ItemFormFields
        name={name}
        kind={kind}
        onNameChange={onNameChange}
        onKindChange={onKindChange}
      />

      {/* Profile selector — the chosen profile's storage mode determines how the
          item is encrypted (zero-knowledge vs server-managed). */}
      <fieldset className="flex flex-col gap-2">
        <div className="text-sm font-medium">Profile</div>
        {profileOptions.length > 1 ? (
          <SearchableSelect
            options={profileOptions}
            value={selectedProfileId}
            onValueChange={onSelectProfile}
            placeholder="Select a profile"
          />
        ) : (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            {profilesLoading ? (
              <span className="text-muted-foreground">Loading profiles...</span>
            ) : selectedProfile ? (
              profileOptionLabel(selectedProfile)
            ) : (
              <span className="text-muted-foreground">No profiles available</span>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          The item is stored in this profile and inherits its storage mode.
        </p>
      </fieldset>

      {/* ZK warning */}
      {storageMode === "zero_knowledge" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/30">
          <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Zero-knowledge items are encrypted in your browser. You will need your profile password
            to decrypt them. The server never sees the plaintext.
          </p>
        </div>
      )}

      {/* Per-kind fields */}
      <KindFieldEditor kind={kind} fieldValues={fieldValues} onChange={onFieldsChange} />
    </form>
  );
}

/* ---- Container ---- */

interface CreateItemPanelProps {
  open: boolean;
  onClose: () => void;
}

export function CreateItemPanel({ open, onClose }: CreateItemPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const { activeOrgId } = useOrgStore();
  const { requestUnlock } = useVault();
  const formId = useId();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ItemKind>("opaque");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const { data: profilesData, isLoading: profilesLoading } = useQuery({
    queryKey: dashboardQueryKeys.profiles(activeOrgId ?? ""),
    queryFn: () => browserTrpcClient.profiles.list.query({ orgId: activeOrgId ?? "" }),
    enabled: Boolean(activeOrgId) && open,
  });
  const profiles = useMemo<Profile[]>(() => profilesData?.profiles ?? [], [profilesData]);

  // Resolve the effective selection: the user's pick if it still exists in the
  // org's profiles, else the org default (mirrors the server's
  // `resolveTargetProfile` default-profile fallback). Deriving — rather than
  // syncing via effect — keeps the selection correct across org switches.
  const effectiveProfileId =
    profiles.find((p) => p.id === selectedProfileId)?.id ?? defaultProfileId(profiles) ?? "";
  const selectedProfile = profiles.find((p) => p.id === effectiveProfileId) ?? null;
  const storageMode: StorageMode = selectedProfile?.storageMode ?? "server_managed";

  function handleKindChange(newKind: ItemKind): void {
    if (newKind === kind) return;
    setKind(newKind);
    setFieldValues({});
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();

    if (!activeOrgId) {
      toast.error("Select an organization before creating items.");
      return;
    }
    if (!selectedProfile) {
      toast.error("Select a profile before creating items.");
      return;
    }

    setCreating(true);

    try {
      // buildFieldsForKind drops empty values and the JSON `__json_next_id`
      // tracking key.
      const fields = buildFieldsForKind(kind, fieldValues);

      const payload = {
        v: 1 as const,
        label: name,
        kind,
        tags: [] as string[],
        fields,
      };

      let body:
        | {
            storageMode: "zero_knowledge";
            id: string;
            label: string;
            encryptedItemKey: string;
            ciphertext: string;
            profileId: string;
          }
        | {
            storageMode: "server_managed";
            payload: typeof payload;
            profileId: string;
          };

      const profileId = selectedProfile.id;

      if (selectedProfile.storageMode === "zero_knowledge") {
        let key: Uint8Array;
        try {
          key = await requestUnlock(profileId);
        } catch {
          toast.error("Profile password required.");
          return;
        }

        // itemId is bound into the XChaCha20-Poly1305 AAD at encrypt time, so
        // generate the UUID here and pass the same value to `items.create`. The
        // server uses `input.id` verbatim; any mismatch would break AAD binding
        // and make the row undecryptable.
        const itemId = crypto.randomUUID();
        const encrypted = encryptItemForProfile(payload, key, {
          profileId,
          itemId,
        });
        body = {
          storageMode: "zero_knowledge",
          id: itemId,
          label: name,
          encryptedItemKey: encrypted.encryptedItemKey,
          ciphertext: encrypted.ciphertext,
          profileId,
        };
      } else {
        body = {
          storageMode: "server_managed",
          payload,
          profileId,
        };
      }

      await browserTrpcClient.items.create.mutate(body);
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgItems(activeOrgId),
      });
      toast.success("Item created.");
      setName("");
      setKind("opaque");
      setFieldValues({});
      onClose();
    } catch (mutationError) {
      toast.error(getClientErrorMessage(mutationError, "Failed to create item"));
    } finally {
      setCreating(false);
    }
  }

  const buttonText = storageMode === "zero_knowledge" ? "Encrypt & save" : "Save";
  const buttonTextCreating = storageMode === "zero_knowledge" ? "Encrypting..." : "Saving...";

  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button form={formId} type="submit" disabled={creating || profilesLoading}>
        {creating ? buttonTextCreating : buttonText}
      </Button>
    </div>
  );

  const content = (
    <CreateItemPanelView
      formId={formId}
      name={name}
      kind={kind}
      profiles={profiles}
      profilesLoading={profilesLoading}
      selectedProfileId={effectiveProfileId}
      storageMode={storageMode}
      fieldValues={fieldValues}
      onNameChange={setName}
      onKindChange={handleKindChange}
      onSelectProfile={setSelectedProfileId}
      onFieldsChange={setFieldValues}
      onSubmit={handleSubmit}
    />
  );

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title="Create item"
      description="Add a secret to your profile."
      footer={footer}
    >
      {content}
    </ResponsiveOverlay>
  );
}
