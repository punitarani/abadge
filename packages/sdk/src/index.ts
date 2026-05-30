export { resolveFieldValue } from "@abadge/core";
export type {
  AbadgeAgentClientConfig,
  AbadgeAgentKeypairConfig,
  AbadgeUserClientConfig,
  Ed25519PrivateKeyJwk,
  ErrorCode,
} from "./client";

import { AbadgeAgentClient, AbadgeUserClient } from "./client";

export { AbadgeAgentClient, AbadgeUserClient };

/**
 * Namespaced entry point for the SDK clients.
 *
 * @example
 * ```typescript
 * import { Abadge } from "@abadge/sdk";
 *
 * const user = new Abadge.User({ apiUrl, sessionToken });
 * const agent = new Abadge.Agent({ apiUrl, agentId, privateKey });
 * ```
 */
export const Abadge = {
  User: AbadgeUserClient,
  Agent: AbadgeAgentClient,
} as const;
export { AbadgeApiError } from "./errors";
/**
 * Helper for wrapping a secret the *caller* already holds so it resists
 * accidental disclosure through logs, `JSON.stringify`, and `console.log`.
 *
 * No SDK client method returns a `SecretValue` — agent access flows deliver
 * secrets to the local daemon (env/file injection), not back to the SDK as
 * plaintext. This is a utility you opt into around your own credential
 * handling; see {@link SecretValue.expose} for the single reveal path.
 */
export { SecretValue } from "./secret-value";
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
  AuditFilters,
  AuditListResult,
  AuditQuery,
  AuditResult,
  BootstrapVaultInput,
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
  Item,
  ItemDetail,
  ItemKind,
  ItemListResult,
  ItemPayload,
  ItemResult,
  ItemSummary,
  KdfParams,
  KeyDerivationParams,
  MountAccessResponse,
  Permission,
  PermissionFilters,
  PermissionListResult,
  ProfileUseAccessInput,
  ProfileUseAccessResponse,
  ReadAccessInput,
  ReadAccessResponse,
  RedeemMountInput,
  RedeemMountResponse,
  ReEncryptedItem,
  RevealAccessResponse,
  RevokeAgentSessionInput,
  RotateKeyInput,
  SetupRecoveryInput,
  StorageMode,
  SuccessResult,
  UpdateItemInput,
  UseAccessInput,
  UseAccessResponse,
  VaultBootstrapInput,
} from "./types";
export type { ValidationIssue } from "./validation-issue";
