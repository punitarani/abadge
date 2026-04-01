/** Vault metadata returned from GET /v1/vault */
export interface Vault {
  id: string;
  userId: string;
  initialized: boolean;
  recoveryEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Input for PUT /v1/vault/bootstrap */
export interface BootstrapVaultInput {
  encryptedMasterKey: string;
  masterKeyNonce: string;
  masterKeySalt: string;
  keyDerivationParams: KeyDerivationParams;
}

export interface KeyDerivationParams {
  algorithm: string;
  iterations?: number;
  memory?: number;
  parallelism?: number;
}

/** Input for POST /v1/vault/change-password */
export interface ChangePasswordInput {
  currentEncryptedMasterKey: string;
  newEncryptedMasterKey: string;
  newMasterKeyNonce: string;
  newMasterKeySalt: string;
  newKeyDerivationParams: KeyDerivationParams;
}

/** Input for POST /v1/vault/rotate-key */
export interface RotateKeyInput {
  newEncryptedMasterKey: string;
  newMasterKeyNonce: string;
  reEncryptedItems: ReEncryptedItem[];
}

export interface ReEncryptedItem {
  itemId: string;
  encryptedItemKey: string;
  ciphertext: string;
}

/** Input for POST /v1/vault/recovery/setup */
export interface SetupRecoveryInput {
  recoveryBlob: string;
}

/** Vault item (metadata only, no plaintext) */
export interface Item {
  id: string;
  vaultId: string;
  name: string;
  kind: string;
  encryptedItemKey: string;
  ciphertext: string;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

/** Input for POST /v1/items */
export interface CreateItemInput {
  name: string;
  kind: string;
  encryptedItemKey: string;
  ciphertext: string;
  metadata?: Record<string, string>;
}

/** Input for PUT /v1/items/:id */
export interface UpdateItemInput {
  name?: string;
  kind?: string;
  encryptedItemKey?: string;
  ciphertext?: string;
  metadata?: Record<string, string> | null;
}

/** Principal (agent/service identity with API key) */
export interface Principal {
  id: string;
  vaultId: string;
  name: string;
  prefix: string;
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Input for POST /v1/principals */
export interface CreatePrincipalInput {
  name: string;
}

/** Response from creating or rotating a principal */
export interface PrincipalWithKey {
  principal: Principal;
  apiKey: string;
}

/** Grant (permission linking principal to item) */
export interface Grant {
  id: string;
  principalId: string;
  itemId: string;
  permissions: string[];
  expiresAt: string | null;
  createdAt: string;
}

/** Input for POST /v1/grants */
export interface CreateGrantInput {
  principalId: string;
  itemId: string;
  permissions: string[];
  expiresAt?: string;
}

/** Filters for GET /v1/grants */
export interface GrantFilters {
  principalId?: string;
  itemId?: string;
}

/** Response from POST /v1/access/ciphertext */
export interface CiphertextAccessResponse {
  encryptedItemKey: string;
  ciphertext: string;
}

/** Response from POST /v1/access/reveal */
export interface RevealAccessResponse {
  value: string;
}

/** Response from POST /v1/access/mount */
export interface MountAccessResponse {
  path: string;
  ttlSeconds: number;
}

/** Audit log entry */
export interface AuditEntry {
  id: string;
  vaultId: string;
  principalId: string | null;
  action: string;
  itemId: string | null;
  outcome: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  timestamp: string;
}

/** Filters for GET /v1/audit */
export interface AuditFilters {
  principalId?: string;
  itemId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}
