import type {
  ItemKind,
  StorageMode,
  PrincipalKind,
  PrincipalLocality,
  Capability,
  AuditEventType,
  AuditResult,
} from "./constants";

/** Vault metadata (no plaintext key material). */
export interface Vault {
  id: string;
  userId: string;
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: Record<string, unknown>;
  recoveryWrappedRootKey: string | null;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Item as returned by the API (ciphertext fields, no plaintext). */
export interface Item {
  id: string;
  userId: string;
  vaultId: string | null;
  storageMode: StorageMode;
  /** ZK fields — present when storageMode is zero_knowledge */
  encryptedItemKey: string | null;
  ciphertext: string | null;
  /** Server-managed fields — never returned to client */
  cryptoVersion: number;
  contentVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Item plaintext envelope (decrypted client-side for ZK items). */
export interface ItemPayload {
  v: number;
  label: string;
  kind: ItemKind;
  tags: string[];
  notes?: string;
  fields: Record<string, unknown>;
}

/** Principal (device, CLI, MCP, or remote agent). */
export interface Principal {
  id: string;
  userId: string;
  kind: PrincipalKind;
  locality: PrincipalLocality;
  name: string;
  secretPrefix: string | null;
  enabled: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Response when registering a new principal (includes one-time secret). */
export interface PrincipalRegistration {
  principal: Principal;
  /** Full API key — shown once, never stored. */
  secret: string;
}

/** Grant linking a principal to an item with a capability. */
export interface Grant {
  id: string;
  principalId: string;
  itemId: string;
  capability: Capability;
  expiresAt: string | null;
  grantedBy: string;
  createdAt: string;
}

/** Audit log entry. */
export interface AuditEntry {
  id: number;
  userId: string;
  principalId: string | null;
  itemId: string | null;
  eventType: AuditEventType;
  result: AuditResult;
  deliveryMode: string | null;
  meta: Record<string, unknown>;
  ipAddress: string | null;
  occurredAt: string;
}

/** Response for access/ciphertext endpoint. */
export interface CiphertextAccessResponse {
  encryptedItemKey: string;
  ciphertext: string;
  cryptoVersion: number;
}

/** Response for access/reveal endpoint. */
export interface RevealAccessResponse {
  payload: ItemPayload;
}
