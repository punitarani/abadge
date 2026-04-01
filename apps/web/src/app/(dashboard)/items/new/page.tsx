"use client";

import { clientEnv } from "@abadge/env/client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { extractApiError } from "@/lib/api-client";
import { encryptItemForVault } from "@/lib/crypto-client";
import { useVault } from "@/lib/vault-context";

type StorageMode = "zk" | "managed";

export default function CreateItemPage(): React.ReactElement {
  const router = useRouter();
  const { rootKey } = useVault();
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [storageMode, setStorageMode] = useState<StorageMode>("zk");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setCreating(true);
    setError("");

    try {
      let body: Record<string, unknown>;

      if (storageMode === "zk") {
        if (!rootKey) {
          setError("Vault is locked");
          setCreating(false);
          return;
        }
        const payload = { v: 1, label: name, kind: "opaque" as const, tags: [], fields: { value } };
        const encrypted = encryptItemForVault(payload, rootKey);
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

      const res = await fetch(`${apiUrl}/v1/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push("/items");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(extractApiError(data, "Failed to create item"));
      }
    } catch {
      setError("An unexpected error occurred");
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
                  value="zk"
                  checked={storageMode === "zk"}
                  onChange={() => setStorageMode("zk")}
                />
                Zero-knowledge (client-encrypted)
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="storageMode"
                  value="managed"
                  checked={storageMode === "managed"}
                  onChange={() => setStorageMode("managed")}
                />
                Server-managed
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {storageMode === "zk"
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
