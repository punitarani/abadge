"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { decryptItemFromVault } from "@/lib/crypto-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";
import { useVault } from "@/lib/vault-context";

export default function ItemDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { requestUnlock } = useVault();
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState("");
  const itemQuery = useQuery({
    queryKey: dashboardQueryKeys.item(id),
    queryFn: () => browserTrpcClient.items.get.query({ itemId: id }),
    enabled: Boolean(id),
  });
  const item = itemQuery.data?.item ?? null;

  async function decryptItem(encryptedItemKey: string, ciphertext: string): Promise<string | null> {
    let key: Uint8Array;
    try {
      key = await requestUnlock();
    } catch {
      setError("Master password required");
      return null;
    }
    try {
      const plaintext = decryptItemFromVault(encryptedItemKey, ciphertext, key);
      return JSON.stringify(plaintext, null, 2);
    } catch {
      setError("Failed to decrypt item");
      return null;
    }
  }

  async function handleReveal(): Promise<void> {
    if (!item) return;
    if (item.storageMode !== "zero_knowledge") {
      setError("Server-managed items can only be revealed by agents through the API");
      return;
    }
    if (!item.encryptedItemKey || !item.ciphertext) {
      setError("Missing encrypted data");
      return;
    }
    setRevealing(true);
    setError("");
    const value = await decryptItem(item.encryptedItemKey, item.ciphertext);
    setRevealing(false);
    if (value !== null) setRevealedValue(value);
  }

  if (itemQuery.isPending) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  if (itemQuery.error) {
    return (
      <div className="text-sm text-red-700">
        {getClientErrorMessage(itemQuery.error, "Failed to load item")}
      </div>
    );
  }

  if (!item) {
    return <div className="text-sm text-muted-foreground">Item not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{item.id.slice(0, 8)}...</h1>
            <Badge variant={item.storageMode === "zero_knowledge" ? "default" : "secondary"}>
              {item.storageMode === "zero_knowledge" ? "Zero-knowledge" : "Server-managed"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Created {formatRelativeTime(item.createdAt)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => router.push("/items")}>
          Back
        </Button>
      </div>

      <div className="border border-border rounded-lg p-5 space-y-4">
        <div className="text-sm font-semibold">Details</div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Storage mode</div>
            <div className="font-medium">
              {item.storageMode === "zero_knowledge" ? "Zero-knowledge" : "Server-managed"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Last updated</div>
            <div className="font-medium">{formatRelativeTime(item.updatedAt)}</div>
          </div>
        </div>
      </div>

      {item.storageMode === "zero_knowledge" && (
        <div className="border border-border rounded-lg p-5 space-y-4">
          <div className="text-sm font-semibold">Secret value</div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {revealedValue !== null ? (
            <div className="space-y-3">
              <pre className="bg-muted border border-border rounded-md p-3 text-sm font-mono whitespace-pre-wrap break-all">
                {revealedValue}
              </pre>
              <Button variant="outline" size="sm" onClick={() => setRevealedValue(null)}>
                Hide
              </Button>
            </div>
          ) : (
            <Button size="sm" onClick={handleReveal} disabled={revealing}>
              {revealing ? "Decrypting..." : "Reveal"}
            </Button>
          )}
        </div>
      )}

      {item.storageMode !== "zero_knowledge" && (
        <div className="border border-border rounded-lg p-5 space-y-2">
          <div className="text-sm font-semibold">Secret value</div>
          <p className="text-sm text-muted-foreground">
            Server-managed items are encrypted server-side. Agents can access them through the API
            with appropriate permissions.
          </p>
        </div>
      )}
    </div>
  );
}
