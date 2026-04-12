export const OPERATOR_TOKEN_PREFIX = "abo_";

export const OPERATOR_TOKEN_SCOPES = [
  "items:read",
  "items:write",
  "agents:read",
  "agents:write",
  "permissions:read",
  "permissions:write",
  "audit:read",
  "vault:read",
  "vault:write",
] as const;

export type OperatorTokenScope = (typeof OPERATOR_TOKEN_SCOPES)[number];
