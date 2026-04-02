type ItemKind = "login" | "api_key" | "token" | "json" | "certificate" | "ssh_key" | "opaque";

type StorageMode = "zero_knowledge" | "server_managed";

type AgentKind = "device" | "local_cli" | "local_mcp" | "remote_agent";

type AgentLocality = "local" | "remote";

type Capability =
  | "read_ciphertext"
  | "reveal_plaintext"
  | "mount_env"
  | "mount_file"
  | "use_without_reveal";

type AuditEventType =
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

type AuditResult = "allowed" | "denied" | "expired" | "revoked";

type JsonRecord = Record<string, unknown>;

export interface KdfParams {
  algorithm: "argon2id";
  memory: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
}

export interface ItemPayload {
  v: number;
  label: string;
  kind: ItemKind;
  tags: string[];
  notes?: string;
  fields: JsonRecord;
}

export interface VaultBootstrapInput {
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: KdfParams;
}

export interface ChangePasswordInput {
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: KdfParams;
}

export interface RecoverySetupInput {
  recoveryWrappedRootKey: string;
}

export interface RotateKeyInput {
  wrappedRootKey: string;
  recoveryWrappedRootKey?: string;
  rekeyedItems: Record<string, string>;
}

export interface ZeroKnowledgeCreateItemInput {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
}

export interface ServerManagedCreateItemInput {
  storageMode: "server_managed";
  payload: ItemPayload;
}

export type CreateItemInput = ZeroKnowledgeCreateItemInput | ServerManagedCreateItemInput;

export interface ZeroKnowledgeUpdateItemInput {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
  contentVersion: number;
}

export interface ServerManagedUpdateItemInput {
  storageMode: "server_managed";
  payload: ItemPayload;
  contentVersion: number;
}

export type UpdateItemInput = ZeroKnowledgeUpdateItemInput | ServerManagedUpdateItemInput;

export interface ItemSummary {
  id: string;
  storageMode: StorageMode;
  cryptoVersion: number;
  contentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ZeroKnowledgeItemDetail extends ItemSummary {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
}

export interface ServerManagedItemDetail extends ItemSummary {
  storageMode: "server_managed";
}

export type ItemDetail = ZeroKnowledgeItemDetail | ServerManagedItemDetail;
export type Item = ItemDetail;

export interface CreateAgentInput {
  kind: AgentKind;
  name: string;
  metadata?: JsonRecord;
}

export interface Agent {
  id: string;
  userId: string;
  kind: AgentKind;
  locality: AgentLocality;
  name: string;
  keyPrefix: string | null;
  enabled: boolean;
  revokedAt: string | null;
  lastUsedAt: string | null;
  metadata: JsonRecord;
  createdAt: string;
}

export interface AgentWithKey {
  agent: Agent;
  apiKey: string;
}

export interface AgentRotateResult {
  apiKey: string;
  keyPrefix: string;
}

export interface CreatePermissionInput {
  agentId: string;
  itemId: string;
  capability: Capability;
  expiresAt?: string;
}

export interface Permission {
  id: string;
  agentId: string;
  itemId: string;
  capability: Capability;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AuditQuery {
  eventType?: AuditEventType;
  result?: AuditResult;
  agentId?: string;
  itemId?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditEntry {
  id: number;
  userId: string;
  agentId: string | null;
  itemId: string | null;
  eventType: AuditEventType;
  result: AuditResult;
  deliveryMode: string | null;
  meta: JsonRecord;
  ipAddress: string | null;
  occurredAt: string;
}

export interface Vault {
  id: string;
  userId: string;
  wrappedRootKey: string;
  kdfSalt: string;
  kdfParams: KdfParams;
  recoveryWrappedRootKey: string | null;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface VaultResult {
  vault: Vault;
}

export interface ItemResult {
  item: ItemDetail;
}

export interface ItemListResult {
  items: ItemSummary[];
}

export interface AgentResult {
  agent: Agent;
}

export interface AgentListResult {
  agents: Agent[];
}

export interface PermissionResult {
  permission: Permission;
}

export interface PermissionListResult {
  permissions: Permission[];
}

export interface AuditListResult {
  entries: AuditEntry[];
  nextCursor: string | null;
}

export interface SuccessResult {
  ok: boolean;
}

export interface CiphertextAccessResponse {
  encryptedItemKey: string;
  ciphertext: string;
  cryptoVersion: number;
}

export interface RevealAccessResponse {
  payload: ItemPayload;
}

export interface ZeroKnowledgeMountAccessResponse {
  storageMode: "zero_knowledge";
  encryptedItemKey: string;
  ciphertext: string;
  cryptoVersion: number;
}

export interface ServerManagedMountAccessResponse {
  storageMode: "server_managed";
  payload: ItemPayload;
}

export type MountAccessResponse =
  | ZeroKnowledgeMountAccessResponse
  | ServerManagedMountAccessResponse;

export type BootstrapVaultInput = VaultBootstrapInput;
export type SetupRecoveryInput = RecoverySetupInput;
export type KeyDerivationParams = KdfParams;
export type PermissionFilters = Partial<Pick<CreatePermissionInput, "agentId" | "itemId">>;
export type AuditFilters = AuditQuery;

export interface ReEncryptedItem {
  itemId: string;
  encryptedItemKey: string;
}
