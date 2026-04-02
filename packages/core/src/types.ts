import type { Schema } from "effect";
import type {
  AgentListResultSchema,
  AgentResultSchema,
  AgentRotateResultSchema,
  AgentSchema,
  AgentWithKeySchema,
  AuditEntrySchema,
  AuditListResultSchema,
  AuditQuerySchema,
  ChangePasswordSchema,
  CiphertextAccessResponseSchema,
  CiphertextAccessSchema,
  CreateAgentSchema,
  CreateItemSchema,
  CreatePermissionSchema,
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
  PermissionResultSchema,
  PermissionSchema,
  RecoverySetupSchema,
  RevealAccessResponseSchema,
  RevealAccessSchema,
  RotateKeySchema,
  SuccessResultSchema,
  UpdateItemSchema,
  VaultBootstrapSchema,
  VaultResultSchema,
  VaultSchema,
} from "./schemas";

type TypeOf<S extends Schema.Schema.Any> = Schema.Schema.Type<S>;

export type KdfParams = TypeOf<typeof KdfParamsSchema>;

export type VaultBootstrapInput = TypeOf<typeof VaultBootstrapSchema>;
export type ChangePasswordInput = TypeOf<typeof ChangePasswordSchema>;
export type RecoverySetupInput = TypeOf<typeof RecoverySetupSchema>;
export type RotateKeyInput = TypeOf<typeof RotateKeySchema>;

export type ItemPayload = TypeOf<typeof ItemPayloadSchema>;
export type CreateItemInput = TypeOf<typeof CreateItemSchema>;
export type UpdateItemInput = TypeOf<typeof UpdateItemSchema>;
export type ItemSummary = TypeOf<typeof ItemSummarySchema>;
export type ItemDetail = TypeOf<typeof ItemDetailSchema>;

export type CreateAgentInput = TypeOf<typeof CreateAgentSchema>;
export type Agent = TypeOf<typeof AgentSchema>;
export type AgentWithKey = TypeOf<typeof AgentWithKeySchema>;
export type AgentRotateResult = TypeOf<typeof AgentRotateResultSchema>;

export type CreatePermissionInput = TypeOf<typeof CreatePermissionSchema>;
export type Permission = TypeOf<typeof PermissionSchema>;
export type AuditQuery = TypeOf<typeof AuditQuerySchema>;
export type AuditEntry = TypeOf<typeof AuditEntrySchema>;

export type CiphertextAccessInput = TypeOf<typeof CiphertextAccessSchema>;
export type RevealAccessInput = TypeOf<typeof RevealAccessSchema>;
export type MountAccessInput = TypeOf<typeof MountAccessSchema>;

export type VaultResult = TypeOf<typeof VaultResultSchema>;
export type ItemResult = TypeOf<typeof ItemResultSchema>;
export type ItemListResult = TypeOf<typeof ItemListResultSchema>;
export type AgentResult = TypeOf<typeof AgentResultSchema>;
export type AgentListResult = TypeOf<typeof AgentListResultSchema>;
export type PermissionResult = TypeOf<typeof PermissionResultSchema>;
export type PermissionListResult = TypeOf<typeof PermissionListResultSchema>;
export type AuditListResult = TypeOf<typeof AuditListResultSchema>;

export type SuccessResult = TypeOf<typeof SuccessResultSchema>;
export type KeyVersionResult = TypeOf<typeof KeyVersionResultSchema>;
export type ItemVersionResult = TypeOf<typeof ItemVersionResultSchema>;

export type CiphertextAccessResponse = TypeOf<typeof CiphertextAccessResponseSchema>;
export type RevealAccessResponse = TypeOf<typeof RevealAccessResponseSchema>;
export type MountAccessResponse = TypeOf<typeof MountAccessResponseSchema>;

export type Vault = TypeOf<typeof VaultSchema>;
