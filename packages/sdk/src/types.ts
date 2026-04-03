/** Classification of secret type stored in an item. */
export type ItemKind =
  | "login"
  | "api_key"
  | "token"
  | "json"
  | "certificate"
  | "ssh_key"
  | "opaque";

/** How an item's secret data is encrypted and managed. */
export type StorageMode = "zero_knowledge" | "server_managed";

/** Classification of an agent, which determines its locality. */
export type AgentKind = "device" | "local_cli" | "local_mcp" | "remote_agent";

/** Whether an agent runs on the same machine as the user or remotely. Derived from AgentKind. */
export type AgentLocality = "local" | "remote";

/** What an agent is allowed to do with an item's secret data. */
export type Capability =
  | "read_ciphertext"
  | "reveal_plaintext"
  | "mount_env"
  | "mount_file"
  | "use_without_reveal";

/** Categories of events recorded in the audit log. */
export type AuditEventType =
  | "vault.bootstrap"
  | "vault.unlock"
  | "vault.password_change"
  | "vault.key_rotate"
  | "item.create"
  | "item.read"
  | "item.update"
  | "item.delete"
  | "agent.create"
  | "agent.rotate"
  | "agent.revoke"
  | "permission.create"
  | "permission.revoke"
  | "access.ciphertext"
  | "access.reveal"
  | "access.mount_env"
  | "access.mount_file";

/** Outcome of an audited access attempt. */
export type AuditResult = "allowed" | "denied" | "expired" | "revoked";

type JsonRecord = Record<string, unknown>;

/** Argon2id key derivation parameters used for vault password hashing. */
export interface KdfParams {
  algorithm: "argon2id";
  memory: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
}

/** The structured plaintext content of an item. This is what gets encrypted. */
export interface ItemPayload {
  /** Payload schema version. */
  v: number;
  /** Human-readable name. */
  label: string;
  /** Secret type classification. */
  kind: ItemKind;
  /** Categorization tags. */
  tags: string[];
  /** Free-form notes. */
  notes?: string;
  /** The actual secret data (key-value pairs). Structure varies by kind. */
  fields: JsonRecord;
}

/** Input for initializing a user's vault. Called once after account creation. */
export interface VaultBootstrapInput {
  /** Root key wrapped by the password-derived KEK. */
  wrappedRootKey: string;
  /** Salt for Argon2id derivation. */
  kdfSalt: string;
  /** Argon2id tuning parameters. */
  kdfParams: KdfParams;
}

/** Input for re-wrapping the root key with a new password. */
export interface ChangePasswordInput {
  /** Root key wrapped by the new password-derived KEK. */
  wrappedRootKey: string;
  /** New salt for Argon2id derivation. */
  kdfSalt: string;
  /** New Argon2id tuning parameters. */
  kdfParams: KdfParams;
}

/** Input for setting a recovery key on the vault. */
export interface RecoverySetupInput {
  /** Root key wrapped by the recovery key. */
  recoveryWrappedRootKey: string;
}

/** Input for rotating the vault root key. Requires re-keying all zero-knowledge items atomically. */
export interface RotateKeyInput {
  /** Root key wrapped by the current password-derived KEK. */
  wrappedRootKey: string;
  /** Root key wrapped by the recovery key (if recovery is configured). */
  recoveryWrappedRootKey?: string;
  /** Map of itemId to newEncryptedItemKey for all zero-knowledge items. */
  rekeyedItems: Record<string, string>;
}

/** Create a zero-knowledge item (client-side encryption). */
export interface ZeroKnowledgeCreateItemInput {
  storageMode: "zero_knowledge";
  /** Per-item DEK wrapped by the root key. */
  encryptedItemKey: string;
  /** XChaCha20-Poly1305 encrypted payload. */
  ciphertext: string;
}

/** Create a server-managed item (server-side encryption). */
export interface ServerManagedCreateItemInput {
  storageMode: "server_managed";
  /** Plaintext payload to be encrypted by the server. */
  payload: ItemPayload;
}

/** Input for creating an encrypted item. Discriminated by storageMode. */
export type CreateItemInput = ZeroKnowledgeCreateItemInput | ServerManagedCreateItemInput;

/** Update a zero-knowledge item. */
export interface ZeroKnowledgeUpdateItemInput {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
  /** Must match the current version for optimistic concurrency control. */
  contentVersion: number;
}

/** Update a server-managed item. */
export interface ServerManagedUpdateItemInput {
  storageMode: "server_managed";
  payload: ItemPayload;
  /** Must match the current version for optimistic concurrency control. */
  contentVersion: number;
}

/** Input for updating an item. Discriminated by storageMode. */
export type UpdateItemInput = ZeroKnowledgeUpdateItemInput | ServerManagedUpdateItemInput;

/** Item metadata returned by list operations (no encrypted data). */
export interface ItemSummary {
  id: string;
  storageMode: StorageMode;
  cryptoVersion: number;
  /** Optimistic concurrency token. Must be passed on updates. */
  contentVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Full detail for a zero-knowledge item, including encrypted blob. */
export interface ZeroKnowledgeItemDetail extends ItemSummary {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
}

/** Full detail for a server-managed item (metadata only; plaintext requires access methods). */
export interface ServerManagedItemDetail extends ItemSummary {
  storageMode: "server_managed";
}

/** Full item detail, discriminated by storageMode. */
export type ItemDetail = ZeroKnowledgeItemDetail | ServerManagedItemDetail;
/** Full item detail, discriminated by storageMode. */
export type Item = ItemDetail;

/** Input for registering a new agent. */
export interface CreateAgentInput {
  /** Agent classification. Determines locality (local vs remote). */
  kind: AgentKind;
  /** Human-readable label (1-255 characters). */
  name: string;
  /** Arbitrary key-value metadata. */
  metadata?: JsonRecord;
}

/** An agent identity that can request access to items. */
export interface Agent {
  id: string;
  userId: string;
  kind: AgentKind;
  /** Derived from kind. Cannot be set directly. */
  locality: AgentLocality;
  name: string;
  /** First characters of the hashed API key, for identification. */
  keyPrefix: string | null;
  enabled: boolean;
  /** Non-null when the agent has been revoked. */
  revokedAt: string | null;
  lastUsedAt: string | null;
  metadata: JsonRecord;
  createdAt: string;
}

/** Agent with its one-time API key. The key is shown exactly once and is never retrievable again. */
export interface AgentWithKey {
  agent: Agent;
  /** The plaintext API key. Store securely -- it will not be shown again. */
  apiKey: string;
}

/** Result of rotating an agent's API key. */
export interface AgentRotateResult {
  /** The new API key. Store securely -- it will not be shown again. */
  apiKey: string;
  /** Prefix of the new key hash, for identification. */
  keyPrefix: string;
}

/** Input for granting a capability to an agent for an item. */
export interface CreatePermissionInput {
  agentId: string;
  itemId: string;
  capability: Capability;
  /** Optional ISO 8601 expiration. Null or omitted means permanent. */
  expiresAt?: string;
}

/** A specific grant of one capability from one agent to one item. */
export interface Permission {
  id: string;
  agentId: string;
  itemId: string;
  capability: Capability;
  /** Null means the permission does not expire. */
  expiresAt: string | null;
  /** User who granted this permission. */
  createdBy: string;
  createdAt: string;
}

/** Filters for querying the audit log. All fields are optional. */
export interface AuditQuery {
  eventType?: AuditEventType;
  result?: AuditResult;
  agentId?: string;
  itemId?: string;
  /** Opaque cursor from a previous response for pagination. */
  cursor?: string;
  /** Maximum entries per page (1-100, default 50). */
  limit?: number;
}

/** An immutable record of an access attempt or management operation. */
export interface AuditEntry {
  id: number;
  userId: string;
  /** Null for user-initiated events. */
  agentId: string | null;
  /** Null for non-item events. */
  itemId: string | null;
  eventType: AuditEventType;
  result: AuditResult;
  /** How the secret was delivered (null for non-access events). */
  deliveryMode: string | null;
  /** Event-specific metadata. */
  meta: JsonRecord;
  ipAddress: string | null;
  occurredAt: string;
}

/** A user's vault. One per user. Holds the wrapped root key for zero-knowledge encryption. */
export interface Vault {
  id: string;
  userId: string;
  /** Root key wrapped by the password-derived KEK. */
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: KdfParams;
  /** Root key wrapped by recovery key, or null if recovery is not configured. */
  recoveryWrappedRootKey: string | null;
  /** Monotonically increasing. Incremented on each key rotation. */
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Response containing vault metadata. */
export interface VaultResult {
  vault: Vault;
}

/** Response containing a single item with full detail. */
export interface ItemResult {
  item: ItemDetail;
}

/** Response containing a list of item summaries (metadata only). */
export interface ItemListResult {
  items: ItemSummary[];
}

/** Response containing a single agent. */
export interface AgentResult {
  agent: Agent;
}

/** Response containing all agents for the current user. */
export interface AgentListResult {
  agents: Agent[];
}

/** Response containing a single permission. */
export interface PermissionResult {
  permission: Permission;
}

/** Response containing a list of permissions. */
export interface PermissionListResult {
  permissions: Permission[];
}

/** Paginated response containing audit log entries. */
export interface AuditListResult {
  entries: AuditEntry[];
  /** Pass as `cursor` for the next page. Null means no more pages. */
  nextCursor: string | null;
}

/** Generic success response. */
export interface SuccessResult {
  ok: boolean;
}

/** Response from accessCiphertext: encrypted blob for local decryption. */
export interface CiphertextAccessResponse {
  encryptedItemKey: string;
  ciphertext: string;
  cryptoVersion: number;
}

/** Response from accessReveal: decrypted plaintext payload. */
export interface RevealAccessResponse {
  payload: ItemPayload;
}

/** Mount response for a zero-knowledge item (encrypted blob for local decryption). */
export interface ZeroKnowledgeMountAccessResponse {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
  cryptoVersion: number;
}

/** Mount response for a server-managed item (decrypted payload). */
export interface ServerManagedMountAccessResponse {
  storageMode: "server_managed";
  payload: ItemPayload;
}

/** Response from accessMount, discriminated by storageMode. */
export type MountAccessResponse =
  | ZeroKnowledgeMountAccessResponse
  | ServerManagedMountAccessResponse;

/** Input for bootstrapping a vault (wrapped root key, KDF salt, and parameters). */
export type BootstrapVaultInput = VaultBootstrapInput;
/** Input for setting up vault recovery (recovery-wrapped root key). */
export type SetupRecoveryInput = RecoverySetupInput;
/** Argon2id key derivation parameters. */
export type KeyDerivationParams = KdfParams;
/** Optional filters for listing permissions by agent and/or item. */
export type PermissionFilters = Partial<Pick<CreatePermissionInput, "agentId" | "itemId">>;
/** Filters for querying the audit log (event type, result, agent, item, pagination). */
export type AuditFilters = AuditQuery;

/** An item that has been re-encrypted during a key rotation. */
export interface ReEncryptedItem {
  itemId: string;
  encryptedItemKey: string;
}
