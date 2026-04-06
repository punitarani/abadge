"use client";

import { useTRPC } from "@abadge/trpc/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { DashboardPanelPage } from "@/components/dashboard/dashboard-panel-page";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { encryptItemForVault } from "@/lib/crypto-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { getClientErrorMessage } from "@/lib/trpc-browser";
import { useVault } from "@/lib/vault-context";

export type StorageMode = "zero_knowledge" | "server_managed";

interface CreateItemPanelViewProps {
  formId: string;
  name: string;
  value: string;
  storageMode: StorageMode;
  error: string;
  onNameChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onStorageModeChange: (value: StorageMode) => void;
  onSubmit: React.FormEventHandler<HTMLFormElement>;
}

export function CreateItemPanelView({
  formId,
  name,
  value,
  storageMode,
  error,
  onNameChange,
  onValueChange,
  onStorageModeChange,
  onSubmit,
}: CreateItemPanelViewProps): React.ReactElement {
  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-5">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="item-name">Name</Label>
        <Input
          id="item-name"
          placeholder="e.g., github-deploy-key"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          required
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <div className="text-sm font-medium">Storage mode</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="storageMode"
              value="zero_knowledge"
              checked={storageMode === "zero_knowledge"}
              onChange={() => onStorageModeChange("zero_knowledge")}
            />
            Zero-knowledge (client-encrypted)
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="storageMode"
              value="server_managed"
              checked={storageMode === "server_managed"}
              onChange={() => onStorageModeChange("server_managed")}
            />
            Server-managed
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {storageMode === "zero_knowledge"
            ? "The secret is encrypted in your browser before being sent to the server. Only you can decrypt it."
            : "The secret is encrypted server-side. Agents can access it through the API."}
        </p>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="item-value">Value</Label>
        <Textarea
          id="item-value"
          placeholder="The secret value"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          required
        />
      </div>
    </form>
  );
}

interface CreateItemPanelProps {
  presentation: "overlay" | "page";
  onClose: () => void;
  open?: boolean;
}

export function CreateItemPanel({
  presentation,
  onClose,
  open = true,
}: CreateItemPanelProps): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { requestUnlock } = useVault();
  const formId = useId();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [storageMode, setStorageMode] = useState<StorageMode>("zero_knowledge");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const createItem = useMutation(
    trpc.items.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.items(),
        });
        router.push("/items");
      },
    }),
  );

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setError("");

    try {
      let body:
        | {
            storageMode: "zero_knowledge";
            encryptedItemKey: string;
            ciphertext: string;
          }
        | {
            storageMode: "server_managed";
            payload: {
              v: number;
              label: string;
              kind: "opaque";
              tags: string[];
              fields: { value: string };
            };
          };

      if (storageMode === "zero_knowledge") {
        let key: Uint8Array;

        try {
          key = await requestUnlock();
        } catch {
          setError("Master password required");
          return;
        }

        const payload = { v: 1, label: name, kind: "opaque" as const, tags: [], fields: { value } };
        const encrypted = encryptItemForVault(payload, key);
        body = {
          storageMode: "zero_knowledge",
          encryptedItemKey: encrypted.encryptedItemKey,
          ciphertext: encrypted.ciphertext,
        };
      } else {
        body = {
          storageMode: "server_managed",
          payload: { v: 1, label: name, kind: "opaque", tags: [], fields: { value } },
        };
      }

      await createItem.mutateAsync(body);
    } catch (mutationError) {
      setError(getClientErrorMessage(mutationError, "Failed to create item"));
    } finally {
      setCreating(false);
    }
  }

  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button form={formId} type="submit" size="sm" disabled={creating}>
        {creating ? "Creating..." : "Create"}
      </Button>
    </div>
  );

  const content = (
    <CreateItemPanelView
      formId={formId}
      name={name}
      value={value}
      storageMode={storageMode}
      error={error}
      onNameChange={setName}
      onValueChange={setValue}
      onStorageModeChange={setStorageMode}
      onSubmit={handleSubmit}
    />
  );

  if (presentation === "overlay") {
    return (
      <ResponsiveOverlay
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onClose();
          }
        }}
        title="Create item"
        description="Add a secret to your vault."
        footer={footer}
      >
        {content}
      </ResponsiveOverlay>
    );
  }

  return (
    <DashboardPanelPage
      title="Create item"
      description="Add a secret to your vault."
      footer={footer}
      maxWidthClassName="max-w-lg"
    >
      {content}
    </DashboardPanelPage>
  );
}
