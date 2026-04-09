"use client";

import type { ItemDetail } from "@abadge/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { decryptItemFromVault } from "@/lib/crypto-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";
import { useVault } from "@/lib/vault-context";

function storageModeLabel(storageMode: ItemDetail["storageMode"]): string {
  return storageMode === "zero_knowledge" ? "Zero-knowledge" : "Server-managed";
}

interface ItemDetailPanelViewProps {
  item: ItemDetail;
  revealedValue: string | null;
  revealing: boolean;
  onReveal: () => void;
  onHide: () => void;
}

export function ItemDetailPanelView({
  item,
  revealedValue,
  revealing,
  onReveal,
  onHide,
}: ItemDetailPanelViewProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-lg border border-border p-5">
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-muted px-2 py-1 font-mono text-xs">{item.id}</code>
          <Badge variant={item.storageMode === "zero_knowledge" ? "default" : "secondary"}>
            {storageModeLabel(item.storageMode)}
          </Badge>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <div className="text-muted-foreground">Created</div>
            <div className="font-medium">{formatRelativeTime(item.createdAt)}</div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-muted-foreground">Last updated</div>
            <div className="font-medium">{formatRelativeTime(item.updatedAt)}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-5">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold">Secret value</div>
          <p className="text-sm text-muted-foreground">
            {item.storageMode === "zero_knowledge"
              ? "Decrypt the item in your browser when you need to inspect it."
              : "Server-managed items are encrypted server-side. You can reveal the value below."}
          </p>
        </div>

        {revealedValue !== null ? (
          <div className="flex flex-col gap-3">
            <pre className="rounded-md border border-border bg-muted p-3 text-sm whitespace-pre-wrap break-all">
              {revealedValue}
            </pre>
            <div>
              <Button variant="outline" size="sm" onClick={onHide}>
                Hide
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button size="sm" onClick={onReveal} disabled={revealing}>
              {revealing
                ? item.storageMode === "zero_knowledge"
                  ? "Decrypting..."
                  : "Loading..."
                : "Reveal"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ItemDetailPanelProps {
  itemId: string;
  open: boolean;
  onClose: () => void;
}

export function ItemDetailPanel({
  itemId,
  onClose,
  open,
}: ItemDetailPanelProps): React.ReactElement {
  const { requestUnlock } = useVault();
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const itemQuery = useQuery({
    queryKey: dashboardQueryKeys.item(itemId),
    queryFn: () => browserTrpcClient.items.get.query({ itemId }),
    enabled: Boolean(itemId),
  });
  const item = itemQuery.data?.item ?? null;

  async function revealZeroKnowledge(): Promise<string | null> {
    if (!item?.encryptedItemKey || !item.ciphertext) {
      toast.error("Missing encrypted data.");
      return null;
    }

    let key: Uint8Array;
    try {
      key = await requestUnlock();
    } catch {
      toast.error("Master password required.");
      return null;
    }

    try {
      const plaintext = decryptItemFromVault(item.encryptedItemKey, item.ciphertext, key);
      return JSON.stringify(plaintext, null, 2);
    } catch {
      toast.error("Failed to decrypt item.");
      return null;
    }
  }

  async function revealServerManaged(): Promise<string | null> {
    if (!item) return null;
    try {
      const result = await browserTrpcClient.items.ownerReveal.query({ itemId: item.id });
      return JSON.stringify(result.payload, null, 2);
    } catch (error) {
      toast.error(getClientErrorMessage(error, "Failed to reveal item"));
      return null;
    }
  }

  async function handleReveal(): Promise<void> {
    if (!item) return;
    setRevealing(true);
    const value =
      item.storageMode === "zero_knowledge"
        ? await revealZeroKnowledge()
        : await revealServerManaged();
    setRevealing(false);
    if (value !== null) setRevealedValue(value);
  }

  const title = item ? `${item.id.slice(0, 8)}…` : "Item details";
  const description = item
    ? `Created ${formatRelativeTime(item.createdAt)}`
    : "Inspect storage metadata and reveal zero-knowledge items.";
  const footer = (
    <div className="flex justify-end">
      <Button variant="outline" size="sm" onClick={onClose}>
        Close
      </Button>
    </div>
  );

  let content: React.ReactNode;

  if (itemQuery.isPending) {
    content = <div className="text-sm text-muted-foreground">Loading...</div>;
  } else if (itemQuery.error) {
    content = (
      <div className="text-sm text-red-700">
        {getClientErrorMessage(itemQuery.error, "Failed to load item")}
      </div>
    );
  } else if (!item) {
    content = <div className="text-sm text-muted-foreground">Item not found.</div>;
  } else {
    content = (
      <ItemDetailPanelView
        item={item}
        revealedValue={revealedValue}
        revealing={revealing}
        onReveal={() => void handleReveal()}
        onHide={() => {
          setRevealedValue(null);
        }}
      />
    );
  }

  return (
    <ResponsiveOverlay
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      title={title}
      description={description}
      footer={footer}
      contentClassName="sm:max-w-3xl"
    >
      {content}
    </ResponsiveOverlay>
  );
}
