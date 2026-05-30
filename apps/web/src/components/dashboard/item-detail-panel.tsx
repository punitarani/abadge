"use client";

import type { ItemDetail } from "@abadge/core";
import { Warning } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveOverlay } from "@/components/dashboard/responsive-overlay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveOrg } from "@/hooks/use-active-org";
import { decryptItemFromProfile } from "@/lib/crypto-client";
import { dashboardQueryKeys } from "@/lib/query-keys";
import { browserTrpcClient, getClientErrorMessage } from "@/lib/trpc-browser";
import { formatRelativeTime } from "@/lib/utils";
import { useVault } from "@/lib/vault-context";

function storageModeLabel(storageMode: ItemDetail["storageMode"]): string {
  return storageMode === "zero_knowledge" ? "Zero-knowledge" : "Server-managed";
}

export interface ItemReveal {
  revealedValue: string | null;
  revealing: boolean;
  reveal: () => void;
  hide: () => void;
}

/**
 * Owner-reveal state machine for a single item, shared by the item detail
 * route page (personal accounts) and the {@link ItemDetailPanel} overlay.
 *
 * Zero-knowledge items decrypt in the browser after unlocking the profile
 * vault; server-managed items round-trip through `items.ownerReveal`, which
 * decrypts server-side and audits the read. The server never sees plaintext or
 * the root key for zero-knowledge items.
 */
export function useItemReveal(item: ItemDetail | null): ItemReveal {
  const { requestUnlock } = useVault();
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);

  async function revealZeroKnowledge(): Promise<string | null> {
    if (!item || item.storageMode !== "zero_knowledge") {
      toast.error("Missing encrypted data.");
      return null;
    }
    if (!item.profileId) {
      toast.error("Item is not associated with a profile.");
      return null;
    }
    if (!item.encryptedItemKey || !item.ciphertext) {
      toast.error("Missing encrypted data.");
      return null;
    }

    let key: Uint8Array;
    try {
      key = await requestUnlock(item.profileId);
    } catch {
      toast.error("Master password required.");
      return null;
    }

    try {
      // Rebuild the XChaCha20-Poly1305 AAD from the row metadata so decrypt
      // succeeds only for the specific (profile, item, version) the server
      // persisted.
      const plaintext = decryptItemFromProfile(item.encryptedItemKey, item.ciphertext, key, {
        profileId: item.profileId,
        itemId: item.id,
        contentVersion: item.contentVersion,
      });
      return JSON.stringify(plaintext, null, 2);
    } catch {
      toast.error("Failed to decrypt item.");
      return null;
    }
  }

  async function revealServerManaged(): Promise<string | null> {
    if (!item) return null;
    try {
      const result = await browserTrpcClient.items.ownerReveal.mutate({ itemId: item.id });
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

  return {
    revealedValue,
    revealing,
    reveal: () => void handleReveal(),
    hide: () => setRevealedValue(null),
  };
}

interface SecretValueCardProps {
  item: ItemDetail;
  revealedValue: string | null;
  revealing: boolean;
  onReveal: () => void;
  onHide: () => void;
}

/**
 * The "Secret value" reveal card. Presentational only — reveal state is owned
 * by {@link useItemReveal}. Mounting is gated by {@link ItemSecretSection},
 * which only renders this for personal accounts (the owner's own vault); team
 * organizations stay in custody mode and never see a reveal affordance.
 */
export function SecretValueCard({
  item,
  revealedValue,
  revealing,
  onReveal,
  onHide,
}: SecretValueCardProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-5">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-semibold">Secret value</div>
        <p className="text-sm text-muted-foreground">
          {item.storageMode === "zero_knowledge"
            ? "Decrypt the item in your browser when you need to inspect it. The server never sees the plaintext."
            : "Server-managed items are encrypted server-side. Reveal the value below — the read is recorded in the audit log."}
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
  );
}

interface ItemSecretSectionProps {
  item: ItemDetail;
  isPersonal: boolean;
  reveal: ItemReveal;
}

/**
 * Secret-value region of an item view, gated by workspace posture. Personal
 * accounts (the owner's own vault) get the {@link SecretValueCard} Reveal
 * control; team organizations stay in custody mode and never get a reveal
 * affordance — zero-knowledge items show an informational note, server-managed
 * items show nothing. Centralizing the gate here enforces the custody boundary
 * at the component, so no call site (route page, overlay, or a future one) can
 * mount the Reveal UI for a team org.
 */
export function ItemSecretSection({
  item,
  isPersonal,
  reveal,
}: ItemSecretSectionProps): React.ReactElement | null {
  if (isPersonal) {
    return (
      <SecretValueCard
        item={item}
        revealedValue={reveal.revealedValue}
        revealing={reveal.revealing}
        onReveal={reveal.reveal}
        onHide={reveal.hide}
      />
    );
  }

  // Custody mode: the dashboard never reveals plaintext for team organizations.
  if (item.storageMode === "zero_knowledge") {
    return (
      <div className="flex items-start gap-3 rounded-md border-l-4 border-amber-400 bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
        <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          This is a zero-knowledge item. The server never sees the plaintext. Only authorized local
          agents with the vault password can decrypt this item.
        </p>
      </div>
    );
  }

  return null;
}

interface ItemDetailPanelViewProps {
  item: ItemDetail;
  isPersonal: boolean;
  reveal: ItemReveal;
}

export function ItemDetailPanelView({
  item,
  isPersonal,
  reveal,
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

      <ItemSecretSection item={item} isPersonal={isPersonal} reveal={reveal} />
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
  const { isPersonal } = useActiveOrg();
  const itemQuery = useQuery({
    queryKey: dashboardQueryKeys.item(itemId),
    queryFn: () => browserTrpcClient.items.get.query({ itemId }),
    enabled: Boolean(itemId),
  });
  const item = itemQuery.data?.item ?? null;
  const reveal = useItemReveal(item);

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
    content = <ItemDetailPanelView item={item} isPersonal={isPersonal} reveal={reveal} />;
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
