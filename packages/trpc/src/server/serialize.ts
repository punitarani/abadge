import type { AuditEntry, Grant, ItemDetail, ItemSummary, Principal, Vault } from "@abadge/core";
import type { auditLog, grants, items, principals, vaults } from "@abadge/db/schema";

type VaultRow = typeof vaults.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type PrincipalRow = typeof principals.$inferSelect;
type GrantRow = typeof grants.$inferSelect;
type AuditRow = typeof auditLog.$inferSelect;

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

export function serializePrincipal(row: PrincipalRow): Principal {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    locality: row.locality,
    name: row.name,
    secretPrefix: row.secretPrefix,
    enabled: row.enabled,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeGrant(row: GrantRow): Grant {
  return {
    id: row.id,
    principalId: row.principalId,
    itemId: row.itemId,
    capability: row.capability,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeAuditEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    userId: row.userId,
    principalId: row.principalId,
    itemId: row.itemId,
    eventType: row.eventType as AuditEntry["eventType"],
    result: row.result as AuditEntry["result"],
    deliveryMode: row.deliveryMode,
    meta: row.meta,
    ipAddress: row.ipAddress,
    occurredAt: row.occurredAt.toISOString(),
  };
}
