export const credentialTypes = ["api_key", "login", "token", "json_blob", "pii", "other"] as const;

export type CredentialType = (typeof credentialTypes)[number];

export const accessActions = ["read", "denied"] as const;

export type AccessAction = (typeof accessActions)[number];

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
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
