import type {
  AuditEntry,
  AuditListResult,
  AuditQuery,
  ChangePasswordInput,
  CiphertextAccessResponse,
  CreateGrantInput,
  CreateItemInput,
  CreatePrincipalInput,
  Grant,
  GrantListResult,
  GrantResult,
  ItemDetail,
  ItemListResult,
  ItemResult,
  KdfParams,
  MountAccessResponse,
  Principal,
  PrincipalListResult,
  PrincipalRegistration,
  PrincipalResult,
  PrincipalRotateResult,
  RecoverySetupInput,
  RevealAccessResponse,
  RotateKeyInput,
  SuccessResult,
  UpdateItemInput,
  Vault,
  VaultBootstrapInput,
  VaultResult,
} from "@abadge/core";

export type {
  AuditEntry,
  AuditListResult,
  AuditQuery,
  ChangePasswordInput,
  CiphertextAccessResponse,
  CreateGrantInput,
  CreateItemInput,
  CreatePrincipalInput,
  Grant,
  GrantListResult,
  GrantResult,
  ItemListResult,
  ItemResult,
  KdfParams,
  MountAccessResponse,
  Principal,
  PrincipalListResult,
  PrincipalRegistration,
  PrincipalResult,
  PrincipalRotateResult,
  RecoverySetupInput,
  RevealAccessResponse,
  RotateKeyInput,
  SuccessResult,
  UpdateItemInput,
  Vault,
  VaultBootstrapInput,
  VaultResult,
};

export type Item = ItemDetail;
export type BootstrapVaultInput = VaultBootstrapInput;
export type SetupRecoveryInput = RecoverySetupInput;
export type KeyDerivationParams = KdfParams;
export type PrincipalWithKey = PrincipalRegistration;
export type GrantFilters = Partial<Pick<CreateGrantInput, "principalId" | "itemId">>;
export type AuditFilters = AuditQuery;
export interface ReEncryptedItem {
  itemId: string;
  encryptedItemKey: string;
}
