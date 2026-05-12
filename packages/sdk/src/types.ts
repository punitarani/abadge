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
  AgentRotateResult,
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
  RecoverySetupInput as SetupRecoveryInput,
  RevealAccessResponse,
  RevokeAgentSessionInput,
  RotateKeyInput,
  StorageMode,
  SuccessResult,
  UpdateItemInput,
  VaultBootstrapInput,
} from "@abadge/core";

export type BootstrapVaultInput = import("@abadge/core").VaultBootstrapInput;
export type KeyDerivationParams = import("@abadge/core").KdfParams;
/**
 * §RM-PR1 — `CreatePermissionInput` is now a discriminated union over
 * (item target, profile target). `Pick` no longer reaches `itemId` because
 * it only exists on one branch, so define the filter shape explicitly. The
 * filter is purely for query-side narrowing; it accepts either target id.
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
