"use client";

import type { ItemDetail } from "@abadge/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DashboardPanelPage } from "@/components/dashboard/dashboard-panel-page";
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
  error: string;
  onReveal: () => void;
  onHide: () => void;
}

export function ItemDetailPanelView({
  item,
  revealedValue,
  revealing,
  error,
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

      {item.storageMode === "zero_knowledge" ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-5">
          <div className="flex flex-col gap-1">
            <div className="text-sm font-semibold">Secret value</div>
            <p className="text-sm text-muted-foreground">
              Decrypt the item in your browser when you need to inspect it.
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}

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
                {revealing ? "Decrypting..." : "Reveal"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-5">
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

interface ItemDetailPanelProps {
  itemId: string;
  presentation: "overlay" | "page";
  onClose: () => void;
  open?: boolean;
}

export function ItemDetailPanel({
  itemId,
  presentation,
  onClose,
  open = true,
}: ItemDetailPanelProps): React.ReactElement {
  const { requestUnlock } = useVault();
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState("");
  const itemQuery = useQuery({
    queryKey: dashboardQueryKeys.item(itemId),
    queryFn: () => browserTrpcClient.items.get.query({ itemId }),
    enabled: Boolean(itemId),
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
    if (!item) {
      return;
    }

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

    if (value !== null) {
      setRevealedValue(value);
    }
  }

  const title = item ? `${item.id.slice(0, 8)}…` : "Item details";
  const description = item
    ? `Created ${formatRelativeTime(item.createdAt)}`
    : "Inspect storage metadata and reveal zero-knowledge items.";
  const headerAction =
    presentation === "page" ? (
      <Button variant="outline" size="sm" onClick={onClose}>
        Back
      </Button>
    ) : null;
  const footer =
    presentation === "overlay" ? (
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    ) : undefined;

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
        error={error}
        onReveal={() => void handleReveal()}
        onHide={() => {
          setError("");
          setRevealedValue(null);
        }}
      />
    );
  }

  if (presentation === "overlay") {
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

  return (
    <DashboardPanelPage
      title={title}
      description={description}
      headerAction={headerAction}
      footer={footer}
      maxWidthClassName="max-w-3xl"
    >
      {content}
    </DashboardPanelPage>
  );
}
