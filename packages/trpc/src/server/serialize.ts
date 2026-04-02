import type {
  Agent,
  AuditEntry,
  AuditEventType,
  ItemDetail,
  ItemSummary,
  Permission,
  Vault,
} from "@abadge/core";
import type { auditLog, grants, items, principals, vaults } from "@abadge/db/schema";

type VaultRow = typeof vaults.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type AgentRow = typeof principals.$inferSelect;
type PermissionRow = typeof grants.$inferSelect;
type AuditRow = typeof auditLog.$inferSelect;

const AUDIT_EVENT_TYPE_ALIASES: Record<string, AuditEventType> = {
  "principal.create": "agent.create",
  "principal.rotate": "agent.rotate",
  "principal.revoke": "agent.revoke",
  "grant.create": "permission.create",
  "grant.revoke": "permission.revoke",
};

export function normalizeAuditEventType(eventType: string): AuditEventType {
  return (AUDIT_EVENT_TYPE_ALIASES[eventType] ?? eventType) as AuditEventType;
}

export function getAuditEventTypeFilters(eventType: AuditEventType): string[] {
  switch (eventType) {
    case "agent.create":
      return ["agent.create", "principal.create"];
    case "agent.rotate":
      return ["agent.rotate", "principal.rotate"];
    case "agent.revoke":
      return ["agent.revoke", "principal.revoke"];
    case "permission.create":
      return ["permission.create", "grant.create"];
    case "permission.revoke":
      return ["permission.revoke", "grant.revoke"];
    default:
      return [eventType];
  }
}

export function serializeVault(row: VaultRow): Vault {
  return {
    id: row.id,
    userId: row.userId,
    wrappedRootKey: row.wrappedRootKey,
    kdfSalt: row.kdfSalt,
    kdfParams: row.kdfParams as Vault["kdfParams"],
    recoveryWrappedRootKey: row.recoveryWrappedRootKey,
    keyVersion: row.keyVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeItemSummary(
  row: Pick<
    ItemRow,
    "id" | "storageMode" | "cryptoVersion" | "contentVersion" | "createdAt" | "updatedAt"
  >,
): ItemSummary {
  return {
    id: row.id,
    storageMode: row.storageMode,
    cryptoVersion: row.cryptoVersion,
    contentVersion: row.contentVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeItemDetail(row: ItemRow): ItemDetail {
  const base = {
    id: row.id,
    storageMode: row.storageMode,
    cryptoVersion: row.cryptoVersion,
    contentVersion: row.contentVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };

  if (row.storageMode === "zero_knowledge") {
    return {
      ...base,
      storageMode: "zero_knowledge",
      encryptedItemKey: row.encryptedItemKey ?? "",
      ciphertext: row.ciphertext ?? "",
    };
  }

  return {
    ...base,
    storageMode: "server_managed",
  };
}

export function serializeAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    locality: row.locality,
    name: row.name,
    keyPrefix: row.secretPrefix,
    enabled: row.enabled,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializePermission(row: PermissionRow): Permission {
  return {
    id: row.id,
    agentId: row.principalId,
    itemId: row.itemId,
    capability: row.capability,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdBy: row.grantedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    userId: row.userId,
    agentId: row.principalId,
    itemId: row.itemId,
    eventType: normalizeAuditEventType(row.eventType),
    result: row.result as AuditEntry["result"],
    deliveryMode: row.deliveryMode,
    meta: row.meta,
    ipAddress: row.ipAddress,
    occurredAt: row.occurredAt.toISOString(),
  };
}
