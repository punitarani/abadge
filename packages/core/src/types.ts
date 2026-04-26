import type { Schema } from "effect";
import type {
  AgentBootstrapTokenResultSchema,
  AgentChallengeResultSchema,
  AgentEnrollmentResultSchema,
  AgentListResultSchema,
  AgentRegistrationResultSchema,
  AgentResultSchema,
  AgentRotateResultSchema,
  AgentSchema,
  AgentSessionResultSchema,
  AgentSessionSchema,
  AgentWithKeySchema,
  AuditEntrySchema,
  AuditListResultSchema,
  AuditQuerySchema,
  ChangePasswordSchema,
  CiphertextAccessResponseSchema,
  CiphertextAccessSchema,
  CliLocalAgentReferenceSchema,
  CliProfileConfigSchema,
  CreateAgentChallengeSchema,
  CreateAgentSchema,
  CreateItemSchema,
  CreatePermissionSchema,
  DaemonOperatorSessionSchema,
  EnrollAgentSchema,
  ExchangeAgentSessionSchema,
  IssueAgentBootstrapTokenSchema,
  ItemDetailSchema,
  ItemListResultSchema,
  ItemPayloadSchema,
  ItemResultSchema,
  ItemSummarySchema,
  ItemVersionResultSchema,
  KdfParamsSchema,
  KeyVersionResultSchema,
  MountAccessResponseSchema,
  MountAccessSchema,
  PermissionListResultSchema,
  PermissionSchema,
  ProfileListResultSchema,
  ProfileResultSchema,
  ProfileSchema,
  RecoverySetupSchema,
  RekeyedItemSchema,
  RevealAccessResponseSchema,
  RevealAccessSchema,
  RevokeAgentSessionSchema,
  RotateKeySchema,
  SuccessResultSchema,
  UpdateItemSchema,
  VaultBootstrapSchema,
} from "./schemas";

type TypeOf<S extends Schema.Schema.Any> = Schema.Schema.Type<S>;

export type KdfParams = TypeOf<typeof KdfParamsSchema>;

export type VaultBootstrapInput = TypeOf<typeof VaultBootstrapSchema>;
export type ChangePasswordInput = TypeOf<typeof ChangePasswordSchema>;
export type RecoverySetupInput = TypeOf<typeof RecoverySetupSchema>;
export type RotateKeyInput = TypeOf<typeof RotateKeySchema>;
export type RekeyedItem = TypeOf<typeof RekeyedItemSchema>;
export type Profile = TypeOf<typeof ProfileSchema>;

export type ItemPayload = TypeOf<typeof ItemPayloadSchema>;
export type CreateItemInput = TypeOf<typeof CreateItemSchema>;
export type UpdateItemInput = TypeOf<typeof UpdateItemSchema>;
export type ItemSummary = TypeOf<typeof ItemSummarySchema>;
export type ItemDetail = TypeOf<typeof ItemDetailSchema>;

export type CreateAgentInput = TypeOf<typeof CreateAgentSchema>;
export type Agent = TypeOf<typeof AgentSchema>;
export type AgentWithKey = TypeOf<typeof AgentWithKeySchema>;
export type AgentRegistrationResult = TypeOf<typeof AgentRegistrationResultSchema>;
export type AgentRotateResult = TypeOf<typeof AgentRotateResultSchema>;
export type IssueAgentBootstrapTokenInput = TypeOf<typeof IssueAgentBootstrapTokenSchema>;
export type AgentBootstrapTokenResult = TypeOf<typeof AgentBootstrapTokenResultSchema>;
export type EnrollAgentInput = TypeOf<typeof EnrollAgentSchema>;
export type AgentEnrollmentResult = TypeOf<typeof AgentEnrollmentResultSchema>;
export type CreateAgentChallengeInput = TypeOf<typeof CreateAgentChallengeSchema>;
export type AgentChallengeResult = TypeOf<typeof AgentChallengeResultSchema>;
export type ExchangeAgentSessionInput = TypeOf<typeof ExchangeAgentSessionSchema>;
export type AgentSession = TypeOf<typeof AgentSessionSchema>;
export type AgentSessionResult = TypeOf<typeof AgentSessionResultSchema>;
export type RevokeAgentSessionInput = TypeOf<typeof RevokeAgentSessionSchema>;
export type CliLocalAgentReference = TypeOf<typeof CliLocalAgentReferenceSchema>;
export type CliProfileConfig = TypeOf<typeof CliProfileConfigSchema>;
export type DaemonOperatorSession = TypeOf<typeof DaemonOperatorSessionSchema>;

export type CreatePermissionInput = TypeOf<typeof CreatePermissionSchema>;
export type Permission = TypeOf<typeof PermissionSchema>;
export type AuditQuery = TypeOf<typeof AuditQuerySchema>;
export type AuditEntry = TypeOf<typeof AuditEntrySchema>;

export type CiphertextAccessInput = TypeOf<typeof CiphertextAccessSchema>;
export type RevealAccessInput = TypeOf<typeof RevealAccessSchema>;
export type MountAccessInput = TypeOf<typeof MountAccessSchema>;

export type ItemResult = TypeOf<typeof ItemResultSchema>;
export type ItemListResult = TypeOf<typeof ItemListResultSchema>;
export type AgentResult = TypeOf<typeof AgentResultSchema>;
export type AgentListResult = TypeOf<typeof AgentListResultSchema>;
export type PermissionListResult = TypeOf<typeof PermissionListResultSchema>;
export type AuditListResult = TypeOf<typeof AuditListResultSchema>;
export type ProfileResult = TypeOf<typeof ProfileResultSchema>;
export type ProfileListResult = TypeOf<typeof ProfileListResultSchema>;

export type SuccessResult = TypeOf<typeof SuccessResultSchema>;
export type KeyVersionResult = TypeOf<typeof KeyVersionResultSchema>;
export type ItemVersionResult = TypeOf<typeof ItemVersionResultSchema>;

export type CiphertextAccessResponse = TypeOf<typeof CiphertextAccessResponseSchema>;
export type RevealAccessResponse = TypeOf<typeof RevealAccessResponseSchema>;
export type MountAccessResponse = TypeOf<typeof MountAccessResponseSchema>;
