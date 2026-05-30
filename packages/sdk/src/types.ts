export type {
  Agent,
  AgentAuthMethod,
  AgentBootstrapTokenResult,
  AgentChallengeResult,
  AgentEnrollmentResult,
  AgentKind,
  AgentListResult,
  AgentLocality,
  AgentRegistrationResult,
  AgentResult,
  AgentSession,
  AgentSessionResult,
  AgentWithKey,
  AuditEntry,
  AuditEventType,
  AuditListResult,
  AuditQuery,
  AuditResult,
  BulkMountEnvInput,
  BulkMountEnvItem,
  BulkMountEnvResponse,
  Capability,
  ChangePasswordInput,
  CiphertextAccessResponse,
  CreateAgentChallengeInput,
  CreateAgentInput,
  CreateItemInput,
  CreatePermissionInput,
  DaemonOperatorSession,
  EnrollAgentInput,
  ExchangeAgentSessionInput,
  IssueAgentBootstrapTokenInput,
  ItemDetail,
  ItemKind,
  ItemListResult,
  ItemPayload,
  ItemResult,
  ItemSummary,
  KdfParams,
  MountAccessResponse,
  Permission,
  PermissionListResult,
  ProfileUseAccessInput,
  ProfileUseAccessResponse,
  ReadAccessInput,
  ReadAccessResponse,
  RecoverySetupInput as SetupRecoveryInput,
  RedeemMountInput,
  RedeemMountResponse,
  RevealAccessResponse,
  RevokeAgentSessionInput,
  RotateKeyInput,
  StorageMode,
  SuccessResult,
  UpdateItemInput,
  UseAccessInput,
  UseAccessResponse,
  VaultBootstrapInput,
} from "@abadge/core";

export type BootstrapVaultInput = import("@abadge/core").VaultBootstrapInput;
export type KeyDerivationParams = import("@abadge/core").KdfParams;
/**
 * Query-side filter for listing permissions. Defined explicitly rather than
 * derived from `CreatePermissionInput`: that type is a discriminated union over
 * (item target, profile target), so `itemId` lives on only one branch and is
 * not reachable via `Pick`. The filter accepts either target id.
 */
export interface PermissionFilters {
  agentId?: string;
  itemId?: string;
  profileId?: string;
}
export type AuditFilters = import("@abadge/core").AuditQuery;

export type Item = import("@abadge/core").ItemDetail;

export interface ReEncryptedItem {
  itemId: string;
  encryptedItemKey: string;
}
