export const credentialTypes = [
  "api_key",
  "login",
  "token",
  "json_blob",
  "pii",
  "other",
  "oauth_client",
  "service_account_json",
  "cookie_session",
] as const;
export type CredentialType = (typeof credentialTypes)[number];

export const accessActions = ["read", "denied"] as const;
export type AccessAction = (typeof accessActions)[number];

export const deliveryModes = [
  "reveal",
  "env_inject",
  "file_mount",
  "browser_fill",
  "operation_only",
] as const;
export type DeliveryMode = (typeof deliveryModes)[number];

export const environments = ["dev", "staging", "prod"] as const;
export type Environment = (typeof environments)[number];

export const ownerScopes = ["user", "org", "system"] as const;
export type OwnerScope = (typeof ownerScopes)[number];

export const sensitivities = ["low", "medium", "high", "critical"] as const;
export type Sensitivity = (typeof sensitivities)[number];

export const principalTypes = ["human", "app", "agent", "workload"] as const;
export type PrincipalType = (typeof principalTypes)[number];

export const accessOutcomes = ["allowed", "denied", "pending_approval", "expired"] as const;
export type AccessOutcome = (typeof accessOutcomes)[number];

export const approvalStatuses = ["pending", "approved", "denied", "expired"] as const;
export type ApprovalStatus = (typeof approvalStatuses)[number];

export const sourceTypes = ["native", "external"] as const;
export type SourceType = (typeof sourceTypes)[number];

export const connectorTypes = [
  "native",
  "onepassword",
  "aws_secrets_manager",
  "bitwarden",
  "infisical",
  "doppler",
  "gcloud_secret_manager",
  "hashicorp_vault",
] as const;
export type ConnectorType = (typeof connectorTypes)[number];

export const sessionStatuses = ["active", "expired", "revoked"] as const;
export type SessionStatus = (typeof sessionStatuses)[number];

export const ERROR_CODES = {
  CREDENTIAL_NOT_FOUND: "CREDENTIAL_NOT_FOUND",
  ACCESS_DENIED: "ACCESS_DENIED",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_INACTIVE: "AGENT_INACTIVE",
  INVALID_API_KEY: "INVALID_API_KEY",
  PERMISSION_EXISTS: "PERMISSION_EXISTS",
  PERMISSION_NOT_FOUND: "PERMISSION_NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  RATE_LIMITED: "RATE_LIMITED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  POLICY_VIOLATION: "POLICY_VIOLATION",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  APPROVAL_EXPIRED: "APPROVAL_EXPIRED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SESSION_REVOKED: "SESSION_REVOKED",
  DELIVERY_MODE_NOT_ALLOWED: "DELIVERY_MODE_NOT_ALLOWED",
  CONNECTOR_ERROR: "CONNECTOR_ERROR",
  CONNECTOR_NOT_FOUND: "CONNECTOR_NOT_FOUND",
  POLICY_NOT_FOUND: "POLICY_NOT_FOUND",
  APPROVAL_NOT_FOUND: "APPROVAL_NOT_FOUND",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
