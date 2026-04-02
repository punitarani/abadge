import type { Schema } from "effect";
import type {
  AuditEntrySchema,
  AuditListResultSchema,
  AuditQuerySchema,
  ChangePasswordSchema,
  CiphertextAccessResponseSchema,
  CiphertextAccessSchema,
  CreateGrantSchema,
  CreateItemSchema,
  CreatePrincipalSchema,
  GrantListResultSchema,
  GrantResultSchema,
  GrantSchema,
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
  PrincipalListResultSchema,
  PrincipalRegistrationSchema,
  PrincipalResultSchema,
  PrincipalRotateResultSchema,
  PrincipalSchema,
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

export type CreatePrincipalInput = TypeOf<typeof CreatePrincipalSchema>;
export type Principal = TypeOf<typeof PrincipalSchema>;
export type PrincipalRegistration = TypeOf<typeof PrincipalRegistrationSchema>;
export type PrincipalRotateResult = TypeOf<typeof PrincipalRotateResultSchema>;

export type CreateGrantInput = TypeOf<typeof CreateGrantSchema>;
export type Grant = TypeOf<typeof GrantSchema>;
export type AuditQuery = TypeOf<typeof AuditQuerySchema>;
export type AuditEntry = TypeOf<typeof AuditEntrySchema>;

export type CiphertextAccessInput = TypeOf<typeof CiphertextAccessSchema>;
export type RevealAccessInput = TypeOf<typeof RevealAccessSchema>;
export type MountAccessInput = TypeOf<typeof MountAccessSchema>;

export type VaultResult = TypeOf<typeof VaultResultSchema>;
export type ItemResult = TypeOf<typeof ItemResultSchema>;
export type ItemListResult = TypeOf<typeof ItemListResultSchema>;
export type PrincipalResult = TypeOf<typeof PrincipalResultSchema>;
export type PrincipalListResult = TypeOf<typeof PrincipalListResultSchema>;
export type GrantResult = TypeOf<typeof GrantResultSchema>;
export type GrantListResult = TypeOf<typeof GrantListResultSchema>;
export type AuditListResult = TypeOf<typeof AuditListResultSchema>;

export type SuccessResult = TypeOf<typeof SuccessResultSchema>;
export type KeyVersionResult = TypeOf<typeof KeyVersionResultSchema>;
export type ItemVersionResult = TypeOf<typeof ItemVersionResultSchema>;

export type CiphertextAccessResponse = TypeOf<typeof CiphertextAccessResponseSchema>;
export type RevealAccessResponse = TypeOf<typeof RevealAccessResponseSchema>;
export type MountAccessResponse = TypeOf<typeof MountAccessResponseSchema>;

export type Vault = TypeOf<typeof VaultSchema>;
