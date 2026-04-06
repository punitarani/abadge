"use client";

import { useTRPC } from "@abadge/trpc/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { encryptItemForVault } from "@/lib/crypto-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { getClientErrorMessage } from "@/lib/trpc-browser";
import { useVault } from "@/lib/vault-context";


type StorageMode = "zero_knowledge" | "server_managed";

export default function CreateItemPage(): React.ReactElement {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { requestUnlock } = useVault();
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

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
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

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-lg font-semibold">Create item</h1>
        <p className="text-sm text-muted-foreground">Add a secret to your vault</p>
      </div>

      <div className="border border-border rounded-lg p-5">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="item-name">Name</Label>
            <Input
              id="item-name"
              placeholder="e.g., github-deploy-key"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>Storage mode</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="storageMode"
                  value="zero_knowledge"
                  checked={storageMode === "zero_knowledge"}
                  onChange={() => setStorageMode("zero_knowledge")}
                />
                Zero-knowledge (client-encrypted)
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="storageMode"
                  value="server_managed"
                  checked={storageMode === "server_managed"}
                  onChange={() => setStorageMode("server_managed")}
                />
                Server-managed
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {storageMode === "zero_knowledge"
                ? "The secret is encrypted in your browser before being sent to the server. Only you can decrypt it."
                : "The secret is encrypted server-side. Agents can access it through the API."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="item-value">Value</Label>
            <Textarea
              id="item-value"
              placeholder="The secret value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => router.push("/items")}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
