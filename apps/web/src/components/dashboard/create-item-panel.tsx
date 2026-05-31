"use client";

import type { ItemKind, Profile } from "@abadge/core";
import { Warning } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
  buildFieldsForKind,
  ItemFormFields,
  KindFieldEditor,
} from "@/components/dashboard/item-form-fields";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import { encryptItemForProfile } from "@/lib/crypto-client";
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
  storageMode: StorageMode;
  fieldValues: Record<string, string>;
  onNameChange: (value: string) => void;
  onKindChange: (kind: ItemKind) => void;
  onStorageModeChange: (value: StorageMode) => void;
  onFieldsChange: (fields: Record<string, string>) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

export function CreateItemPanelView({
  formId,
  name,
  kind,
  storageMode,
  fieldValues,
  onNameChange,
  onKindChange,
  onStorageModeChange,
  onFieldsChange,
  onSubmit,
}: CreateItemPanelViewProps): React.ReactElement {
  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ItemFormFields
        name={name}
        kind={kind}
        onNameChange={onNameChange}
        onKindChange={onKindChange}
      />

      <fieldset className="flex flex-col gap-3">
        <div className="text-sm font-medium">Storage mode</div>
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="storageMode"
              value="zero_knowledge"
              checked={storageMode === "zero_knowledge"}
              onChange={() => onStorageModeChange("zero_knowledge")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Zero-knowledge</span>
              <span className="block text-xs text-muted-foreground">
                Your device, your key. Encrypted in your browser before leaving — only you can
                decrypt. Best for personal secrets. Cannot be accessed by remote agents.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="storageMode"
              value="server_managed"
              checked={storageMode === "server_managed"}
              onChange={() => onStorageModeChange("server_managed")}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Server-managed</span>
              <span className="block text-xs text-muted-foreground">
                Encrypted server-side with AES-256-GCM. Can be accessed by local and remote agents
                through the API. Best for credentials shared with automated systems.
              </span>
            </span>
          </label>
        </div>
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
  const [storageMode, setStorageMode] = useState<StorageMode>("server_managed");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  function handleKindChange(newKind: ItemKind): void {
    setKind(newKind);
    setFieldValues({});
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
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
          }
        | {
            storageMode: "server_managed";
            payload: typeof payload;
          };

      if (storageMode === "zero_knowledge") {
        if (!activeOrgId) {
          toast.error("Select an organization before creating items.");
          return;
        }

        // The server inserts ZK items into the org's first ZK profile
        // (items router). Resolve the same profile here so the client
        // encrypts with that profile's root key.
        let zkProfileId: string;
        try {
          const result = await browserTrpcClient.profiles.list.query({ orgId: activeOrgId });
          const zkProfile = result.profiles.find(
            (p: Profile) => p.storageMode === "zero_knowledge",
          );
          if (!zkProfile) {
            toast.error("No zero-knowledge profile in this organization. Create one first.");
            return;
          }
          zkProfileId = zkProfile.id;
        } catch (lookupError) {
          toast.error(getClientErrorMessage(lookupError, "Failed to load profiles"));
          return;
        }

        let key: Uint8Array;
        try {
          key = await requestUnlock(zkProfileId);
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
          profileId: zkProfileId,
          itemId,
        });
        body = {
          storageMode: "zero_knowledge",
          id: itemId,
          label: name,
          encryptedItemKey: encrypted.encryptedItemKey,
          ciphertext: encrypted.ciphertext,
        };
      } else {
        body = {
          storageMode: "server_managed",
          payload,
        };
      }

      await browserTrpcClient.items.create.mutate(body);
      await queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? ""),
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
      <Button form={formId} type="submit" disabled={creating}>
        {creating ? buttonTextCreating : buttonText}
      </Button>
    </div>
  );

  const content = (
    <CreateItemPanelView
      formId={formId}
      name={name}
      kind={kind}
      storageMode={storageMode}
      fieldValues={fieldValues}
      onNameChange={setName}
      onKindChange={handleKindChange}
      onStorageModeChange={setStorageMode}
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
