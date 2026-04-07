export type {
  Agent,
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
  Capability,
  ChangePasswordInput,
  CiphertextAccessResponse,
  CreateAgentChallengeInput,
  CreateAgentInput,
  CreateItemInput,
  CreateOperatorTokenInput,
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
  OperatorToken,
  OperatorTokenCreateResult,
  OperatorTokenListResult,
  OperatorTokenScope,
  Permission,
  PermissionListResult,
  PermissionResult,
  PrincipalAuthMethod,
  RecoverySetupInput as SetupRecoveryInput,
  RevealAccessResponse,
  RevokeAgentSessionInput,
  RevokeOperatorTokenInput,
  RotateKeyInput,
  StorageMode,
  SuccessResult,
  UpdateItemInput,
  Vault,
  VaultBootstrapInput,
  VaultResult,
} from "@abadge/core";

export type BootstrapVaultInput = import("@abadge/core").VaultBootstrapInput;
export type KeyDerivationParams = import("@abadge/core").KdfParams;
export type PermissionFilters = Partial<
  Pick<import("@abadge/core").CreatePermissionInput, "agentId" | "itemId">
>;
export type AuditFilters = import("@abadge/core").AuditQuery;

export type Item = import("@abadge/core").ItemDetail;

export interface ReEncryptedItem {
  itemId: string;
  encryptedItemKey: string;
}
