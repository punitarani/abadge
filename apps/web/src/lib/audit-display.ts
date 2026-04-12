import type { Agent, ItemDisplayEntry } from "@abadge/core";
import { decryptItemFromVault } from "./crypto-client";

const AUDIT_FALLBACK_ID_LENGTH = 13;

export interface AuditDisplayValue {
  text: string;
  resolved: boolean;
}

export function buildAuditAgentNameMap(agents: Agent[]): Map<string, string> {
  return new Map(agents.map((agent) => [agent.id, agent.name]));
}

export function buildAuditItemLabelMap(
  items: ItemDisplayEntry[],
  rootKey: Uint8Array | null,
): Map<string, string> {
  const labels = new Map<string, string>();

  for (const item of items) {
    if ("error" in item) continue;

    if (item.storageMode === "server_managed") {
      labels.set(item.itemId, item.label);
      continue;
    }

    if (!rootKey) {
      continue;
    }

    try {
      const payload = decryptItemFromVault(item.encryptedItemKey, item.ciphertext, rootKey);
      labels.set(item.itemId, payload.label ?? formatAuditIdFallback(item.itemId));
    } catch {}
  }

  return labels;
}

export function formatAuditIdFallback(value: string): string {
  return `${value.slice(0, AUDIT_FALLBACK_ID_LENGTH)}…`;
}

export function resolveAuditDisplayValue(
  value: string | null,
  labels: Map<string, string>,
): AuditDisplayValue {
  if (!value) {
    return { text: "\u2014", resolved: false };
  }

  const label = labels.get(value);
  if (label) {
    return { text: label, resolved: true };
  }

  return { text: formatAuditIdFallback(value), resolved: false };
}
