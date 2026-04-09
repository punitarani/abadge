"use client";

import { useTRPC } from "@abadge/trpc/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
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
  onNameChange,
  onValueChange,
  onStorageModeChange,
  onSubmit,
}: CreateItemPanelViewProps): React.ReactElement {
  return (
    <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-5">
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
  open: boolean;
  onClose: () => void;
}

export function CreateItemPanel({ open, onClose }: CreateItemPanelProps): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { requestUnlock } = useVault();
  const formId = useId();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [storageMode, setStorageMode] = useState<StorageMode>("zero_knowledge");
  const [creating, setCreating] = useState(false);
  const createItem = useMutation(
    trpc.items.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.items(),
        });
        toast.success("Item created.");
        router.push("/items");
      },
    }),
  );

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setCreating(true);

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
          toast.error("Master password required.");
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
      toast.error(getClientErrorMessage(mutationError, "Failed to create item"));
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
      onNameChange={setName}
      onValueChange={setValue}
      onStorageModeChange={setStorageMode}
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
      description="Add a secret to your vault."
      footer={footer}
    >
      {content}
    </ResponsiveOverlay>
  );
}
