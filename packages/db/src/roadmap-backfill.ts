import type { KdfParams, StorageMode } from "@abadge/core";

export interface LegacyUserSeed {
  id: string;
  name?: string | null;
  email?: string | null;
}

export interface LegacyVaultSeed {
  id: string;
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: KdfParams;
  recoveryWrappedRootKey?: string | null;
  keyVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LegacyPrincipalSeed {
  id: string;
  userId: string;
  kind: "device" | "local_cli" | "local_mcp" | "remote" | "remote_agent";
  name: string;
  description?: string | null;
  authMethod: "legacy_api_key" | "public_key_session";
  secretHash?: string | null;
  secretPrefix?: string | null;
  publicKey?: string | null;
  enabled: boolean;
  revokedAt?: Date | null;
  lastUsedAt?: Date | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

function sanitizeSlugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function personalOrganizationIdForUser(userId: string): string {
  return `org_personal_${userId}`;
}

export function personalOrganizationSlugForUser(userId: string): string {
  const slugPart = sanitizeSlugPart(userId);
  return `personal-${slugPart || "user"}`;
}

export function buildPersonalOrganization(user: LegacyUserSeed): {
  id: string;
  name: string;
  slug: string;
  metadata: string;
} {
  const displayName = user.name?.trim() || user.email?.trim() || user.id;

  return {
    id: personalOrganizationIdForUser(user.id),
    name: `${displayName} Personal`,
    slug: personalOrganizationSlugForUser(user.id),
    metadata: JSON.stringify({
      kind: "personal",
      migratedFromUserId: user.id,
    }),
  };
}

export function buildPersonalMembership(userId: string): {
  id: string;
  organizationId: string;
  userId: string;
  role: "owner";
} {
  return {
    id: `member_personal_${userId}`,
    organizationId: personalOrganizationIdForUser(userId),
    userId,
    role: "owner",
  };
}

export function defaultProfileIdForVault(vaultId: string): string {
  return `profile_default_${vaultId}`;
}

export function buildDefaultProfileFromVault(
  organizationId: string,
  vault: LegacyVaultSeed,
): {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  storageMode: StorageMode;
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: KdfParams;
  recoveryWrappedRootKey: string | null;
  keyVersion: number;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: defaultProfileIdForVault(vault.id),
    organizationId,
    name: "default",
    description: "Migrated from the legacy per-user vault.",
    storageMode: "zero_knowledge",
    wrappedRootKey: vault.wrappedRootKey,
    kdfSalt: vault.kdfSalt,
    kdfParams: vault.kdfParams,
    recoveryWrappedRootKey: vault.recoveryWrappedRootKey ?? null,
    keyVersion: vault.keyVersion,
    createdAt: vault.createdAt,
    updatedAt: vault.updatedAt,
  };
}

export function migratedItemLabel(itemId: string): string {
  return `migrated-${itemId.slice(0, 8)}`;
}

function textFromPayload(payload: Uint8Array | string): string {
  return typeof payload === "string" ? payload : new TextDecoder().decode(payload);
}

export function resolveServerManagedBackfillLabel(
  itemId: string,
  payload: Uint8Array | string,
): string {
  const text = textFromPayload(payload);

  try {
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === "object" &&
      "label" in parsed &&
      typeof parsed.label === "string" &&
      parsed.label.trim().length > 0
    ) {
      return parsed.label;
    }
  } catch {
    // Legacy server-managed items may still store raw strings.
  }

  return migratedItemLabel(itemId);
}

export function roadmapAgentKind(
  kind: LegacyPrincipalSeed["kind"],
): "local_cli" | "local_mcp" | "remote" {
  switch (kind) {
    case "local_mcp":
      return "local_mcp";
    case "device":
    case "local_cli":
      return "local_cli";
    case "remote":
    case "remote_agent":
      return "remote";
  }
}

export function roadmapAgentLocality(kind: LegacyPrincipalSeed["kind"]): "local" | "remote" {
  switch (kind) {
    case "device":
    case "local_cli":
    case "local_mcp":
      return "local";
    case "remote":
    case "remote_agent":
      return "remote";
  }
}

export function buildRoadmapAgent(principal: LegacyPrincipalSeed): {
  id: string;
  organizationId: string;
  createdBy: string;
  name: string;
  description: string | null;
  kind: "local_cli" | "local_mcp" | "remote";
  locality: "local" | "remote";
  authMethod: "legacy_api_key" | "public_key_session";
  secretHash: string | null;
  secretPrefix: string | null;
  publicKey: string | null;
  enabled: boolean;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
} {
  return {
    id: principal.id,
    organizationId: personalOrganizationIdForUser(principal.userId),
    createdBy: principal.userId,
    name: principal.name,
    description: principal.description ?? null,
    kind: roadmapAgentKind(principal.kind),
    locality: roadmapAgentLocality(principal.kind),
    authMethod: principal.authMethod,
    secretHash: principal.secretHash ?? null,
    secretPrefix: principal.secretPrefix ?? null,
    publicKey: principal.publicKey ?? null,
    enabled: principal.enabled,
    revokedAt: principal.revokedAt ?? null,
    lastUsedAt: principal.lastUsedAt ?? null,
    metadata: principal.metadata ?? {},
    createdAt: principal.createdAt,
  };
}
