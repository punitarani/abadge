"use client";

import type { ItemDetail, ItemKind, ItemPayload } from "@abadge/core";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import { storageModeLabel } from "@/components/dashboard/item-detail-panel";
import {
  buildFieldsForKind,
  ItemFormFields,
  KindFieldEditor,
  payloadToFieldValues,
} from "@/components/dashboard/item-form-fields";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { encryptItemForProfile } from "@/lib/crypto-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { useVault } from "@/lib/vault-context";
import { useOrgStore } from "@/stores/org-store";

export interface EditItemPanelViewProps {
  formId: string;
  name: string;
  kind: ItemKind;
  storageMode: ItemDetail["storageMode"];
  fieldValues: Record<string, string>;
  onNameChange: (value: string) => void;
  onKindChange: (kind: ItemKind) => void;
  onFieldsChange: (fields: Record<string, string>) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

/**
 * Presentational edit form: name + kind + locked storage-mode badge + per-kind
 * field editors. Storage mode is read-only because the update path cannot change
 * it. Stateless so it can be driven by Storybook or tests.
 */
export function EditItemPanelView({
  formId,
  name,
  kind,
  storageMode,
  fieldValues,
  onNameChange,
  onKindChange,
  onFieldsChange,
  onSubmit,
}: EditItemPanelViewProps): React.ReactElement {
  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ItemFormFields
        name={name}
        kind={kind}
        onNameChange={onNameChange}
        onKindChange={onKindChange}
      />

      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-medium">Storage mode</div>
        <div>
          <Badge variant={storageMode === "zero_knowledge" ? "default" : "secondary"}>
            {storageModeLabel(storageMode)}
          </Badge>
        </div>
      </div>

      <KindFieldEditor kind={kind} fieldValues={fieldValues} onChange={onFieldsChange} />
    </form>
  );
}

interface EditItemPanelProps {
  item: ItemDetail;
  /** The current plaintext payload, revealed before opening the panel. */
  payload: ItemPayload;
  open: boolean;
  onClose: () => void;
}

/**
 * Edit an existing item. Pre-filled from an already-revealed payload, so this
 * panel is mounted by the same call sites that may reveal plaintext (personal
 * accounts) — it never reveals on its own, keeping the custody boundary in
 * {@link useItemReveal}/{@link ItemSecretSection}.
 *
 * Storage mode is fixed (the API/CLI update path cannot change it). The submit
 * mirrors `abadge item update`: server-managed sends the new payload; ZK
 * re-encrypts under the profile root key, binding the AAD to the NEXT
 * contentVersion (current + 1) while sending the CURRENT version for
 * optimistic-concurrency CAS.
 */
export function EditItemPanel({
  item,
  payload,
  open,
  onClose,
}: EditItemPanelProps): React.ReactElement {
  const queryClient = useQueryClient();
  const { activeOrgId } = useOrgStore();
  const { requestUnlock } = useVault();
  const formId = useId();
  const [name, setName] = useState(payload.label ?? item.label);
  const [kind, setKind] = useState<ItemKind>(payload.kind ?? "opaque");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    payloadToFieldValues(payload),
  );
  const [saving, setSaving] = useState(false);

  function handleKindChange(newKind: ItemKind): void {
    setKind(newKind);
    setFieldValues({});
  }

  function buildNextPayload(): ItemPayload {
    // Preserve tags/notes that have no editor here so an edit never silently
    // drops them; buildFieldsForKind drops empty values + the JSON tracking key.
    return {
      v: 1,
      label: name,
      kind,
      tags: payload.tags ?? [],
      ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
      fields: buildFieldsForKind(kind, fieldValues),
    };
  }

  /** Returns false when the edit was aborted (toast already shown). */
  async function runZeroKnowledgeUpdate(nextPayload: ItemPayload): Promise<boolean> {
    if (!item.profileId) {
      toast.error("Item is not associated with a profile.");
      return false;
    }
    let key: Uint8Array;
    try {
      key = await requestUnlock(item.profileId);
    } catch {
      toast.error("Profile password required.");
      return false;
    }
    // The update lands at contentVersion = current + 1; bind that into the AAD
    // so the refreshed row decrypts with the version the server persists.
    const encrypted = encryptItemForProfile(nextPayload, key, {
      profileId: item.profileId,
      itemId: item.id,
      contentVersion: item.contentVersion + 1,
    });
    await browserTrpcClient.items.update.mutate({
      itemId: item.id,
      data: {
        storageMode: "zero_knowledge",
        label: name,
        encryptedItemKey: encrypted.encryptedItemKey,
        ciphertext: encrypted.ciphertext,
        contentVersion: item.contentVersion,
      },
    });
    return true;
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);

    try {
      const nextPayload = buildNextPayload();
      if (item.storageMode === "zero_knowledge") {
        const ok = await runZeroKnowledgeUpdate(nextPayload);
        if (!ok) return;
      } else {
        await browserTrpcClient.items.update.mutate({
          itemId: item.id,
          data: {
            storageMode: "server_managed",
            payload: nextPayload,
            contentVersion: item.contentVersion,
          },
        });
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.item(item.id) }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.orgItems(activeOrgId ?? "") }),
      ]);
      toast.success("Item updated.");
      onClose();
    } catch (mutationError) {
      toast.error(getClientErrorMessage(mutationError, "Failed to update item"));
    } finally {
      setSaving(false);
    }
  }

  const isZK = item.storageMode === "zero_knowledge";
  const buttonText = isZK ? "Encrypt & save" : "Save";
  const buttonTextSaving = isZK ? "Encrypting..." : "Saving...";

  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button form={formId} type="submit" disabled={saving}>
        {saving ? buttonTextSaving : buttonText}
      </Button>
    </div>
  );

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title="Edit item"
      description="Update this secret. Storage mode cannot be changed."
      footer={footer}
    >
      <EditItemPanelView
        formId={formId}
        name={name}
        kind={kind}
        storageMode={item.storageMode}
        fieldValues={fieldValues}
        onNameChange={setName}
        onKindChange={handleKindChange}
        onFieldsChange={setFieldValues}
        onSubmit={handleSubmit}
      />
    </ResponsiveOverlay>
  );
}
