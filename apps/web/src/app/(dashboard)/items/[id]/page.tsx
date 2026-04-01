"use client";

import { clientEnv } from "@abadge/env/client";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { decryptItemFromVault } from "@/lib/crypto-client";
import { formatRelativeTime } from "@/lib/utils";
import { useVault } from "@/lib/vault-context";

interface ItemDetail {
  id: string;
  name: string;
  storageMode: string;
  encryptedItemKey?: string;
  ciphertext?: string;
  itemIv?: string;
  keyIv?: string;
  createdAt: string;
  updatedAt: string;
}

export default function ItemDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { rootKey } = useVault();

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState("");

  const apiUrl = clientEnv.NEXT_PUBLIC_API_URL;

  const fetchItem = useCallback(async () => {
    const res = await fetch(`${apiUrl}/v1/items/${id}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setItem(data.item ?? data);
    }
  }, [apiUrl, id]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  async function handleReveal(): Promise<void> {
    if (!item || !rootKey) return;

    if (item.storageMode === "zk") {
      if (!item.encryptedItemKey || !item.ciphertext || !item.itemIv || !item.keyIv) {
        setError("Missing encrypted data");
        return;
      }
      setRevealing(true);
      setError("");
      try {
        const plaintext = decryptItemFromVault(item.encryptedItemKey, item.ciphertext, rootKey);
        setRevealedValue(JSON.stringify(plaintext, null, 2));
      } catch {
        setError("Failed to decrypt item");
      } finally {
        setRevealing(false);
      }
    } else {
      // Server-managed: metadata only on dashboard; reveal is for agents via API
      setError("Server-managed items can only be revealed by agents through the API");
    }
  }

  if (!item) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{item.name}</h1>
            <Badge variant={item.storageMode === "zk" ? "default" : "secondary"}>
              {item.storageMode === "zk" ? "Zero-knowledge" : "Server-managed"}
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
              {item.storageMode === "zk" ? "Zero-knowledge" : "Server-managed"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Last updated</div>
            <div className="font-medium">{formatRelativeTime(item.updatedAt)}</div>
          </div>
        </div>
      </div>

      {item.storageMode === "zk" && (
        <div className="border border-border rounded-lg p-5 space-y-4">
          <div className="text-sm font-semibold">Secret value</div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          {revealedValue !== null ? (
            <div className="space-y-3">
              <pre className="bg-neutral-50 border border-border rounded-md p-3 text-sm font-mono whitespace-pre-wrap break-all">
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

      {item.storageMode !== "zk" && (
        <div className="border border-border rounded-lg p-5 space-y-2">
          <div className="text-sm font-semibold">Secret value</div>
          <p className="text-sm text-muted-foreground">
            Server-managed items are encrypted server-side. Agents can access them through the API
            with appropriate grants.
          </p>
        </div>
      )}
    </div>
  );
}
