import type {
  Agent,
  AuditEntry,
  ItemDetail,
  ItemSummary,
  Permission,
  Profile,
  Vault,
} from "@abadge/core";
import { AUDIT_EVENT_TYPES, type AuditEventType } from "@abadge/core";
import type { agents, auditLogs, items, permissions, profiles, vaults } from "@abadge/db/schema";

type VaultRow = typeof vaults.$inferSelect;
type ProfileRow = typeof profiles.$inferSelect;
type ItemRow = typeof items.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type PermissionRow = typeof permissions.$inferSelect;
type AuditRow = typeof auditLogs.$inferSelect;

export const LEGACY_AUDIT_EVENT_TYPES = [
  "principal.create",
  "principal.rotate",
  "principal.revoke",
  "grant.create",
  "grant.revoke",
  "vault.bootstrap",
  "vault.unlock",
  "vault.password_change",
  "vault.key_rotate",
  "operator_token.create",
  "operator_token.revoke",
] as const;

type LegacyAuditEventType = (typeof LEGACY_AUDIT_EVENT_TYPES)[number];

const AUDIT_EVENT_TYPE_ALIASES: Record<LegacyAuditEventType, AuditEventType> = {
  "principal.create": "agent.create",
  "principal.rotate": "agent.rotate",
  "principal.revoke": "agent.revoke",
  "grant.create": "permission.create",
  "grant.revoke": "permission.revoke",
  "vault.bootstrap": "profile.create",
  "vault.unlock": "auth.login",
  "vault.password_change": "profile.rotate",
  "vault.key_rotate": "profile.rotate",
  "operator_token.create": "auth.token_issue",
  "operator_token.revoke": "auth.token_revoke",
};

function isAuditEventType(eventType: string): eventType is AuditEventType {
  return (AUDIT_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function normalizeAuditEventType(eventType: string): AuditEventType {
  const normalized = AUDIT_EVENT_TYPE_ALIASES[eventType as LegacyAuditEventType] ?? eventType;

  // Surface unexpected DB/event drift instead of serializing invalid public values.
  if (!isAuditEventType(normalized)) {
    throw new Error(`Unknown audit event type: ${eventType}`);
  }

  return normalized;
}

export function getAuditEventTypeFilters(
  eventType: AuditEventType | LegacyAuditEventType,
): string[] {
  const normalized = normalizeAuditEventType(eventType);

  switch (normalized) {
    case "profile.create":
      return ["profile.create", "vault.bootstrap"];
    case "profile.rotate":
      return ["profile.rotate", "vault.password_change", "vault.key_rotate"];
    case "auth.login":
      return ["auth.login", "vault.unlock"];
    case "auth.token_issue":
      return ["auth.token_issue", "operator_token.create"];
    case "auth.token_revoke":
      return ["auth.token_revoke", "operator_token.revoke"];
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
      return [normalized];
  }
}

export function serializeProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    description: row.description ?? null,
    storageMode: row.storageMode,
    wrappedRootKey: row.wrappedRootKey ?? null,
    kdfSalt: row.kdfSalt ?? null,
    kdfParams: row.kdfParams ? (row.kdfParams as Profile["kdfParams"]) : null,
    recoveryWrappedRootKey: row.recoveryWrappedRootKey ?? null,
    keyVersion: row.keyVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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
    "id" | "label" | "storageMode" | "cryptoVersion" | "contentVersion" | "createdAt" | "updatedAt"
  >,
): ItemSummary {
  return {
    id: row.id,
    label: row.label,
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
    label: row.label,
    storageMode: row.storageMode,
    cryptoVersion: row.cryptoVersion,
    contentVersion: row.contentVersion,
    profileId: row.profileId ?? null,
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
    organizationId: row.organizationId,
    createdBy: row.createdBy,
    kind: row.kind,
    locality: row.locality,
    authMethod: row.authMethod,
    name: row.name,
    description: row.description ?? null,
    publicKeyConfigured: row.publicKey !== null,
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
    organizationId: row.organizationId,
    agentId: row.agentId,
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
    organizationId: row.organizationId,
    userId: row.userId,
    agentId: row.agentId,
    itemId: row.itemId,
    profileId: row.profileId,
    surface: row.surface,
    eventType: normalizeAuditEventType(row.eventType),
    result: row.result as AuditEntry["result"],
    deliveryMode: row.deliveryMode,
    field: row.field,
    purpose: row.purpose,
    meta: row.meta,
    ipAddress: row.ipAddress,
    occurredAt: row.occurredAt.toISOString(),
  };
}
