export const ITEM_KINDS = [
  "login",
  "api_key",
  "token",
  "json",
  "certificate",
  "ssh_key",
  "opaque",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const STORAGE_MODES = ["zero_knowledge", "server_managed"] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

export const AGENT_KINDS = ["device", "local_cli", "local_mcp", "remote_agent"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_LOCALITIES = ["local", "remote"] as const;
export type AgentLocality = (typeof AGENT_LOCALITIES)[number];

export const PRINCIPAL_AUTH_METHODS = ["public_key_session", "legacy_api_key"] as const;
export type PrincipalAuthMethod = (typeof PRINCIPAL_AUTH_METHODS)[number];

export const CAPABILITIES = [
  "read_ciphertext",
  "reveal_plaintext",
  "mount_env",
  "mount_file",
  "use_without_reveal",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const AUDIT_EVENT_TYPES = [
  "vault.bootstrap",
  "vault.unlock",
  "vault.password_change",
  "vault.key_rotate",
  "item.create",
  "item.read",
  "item.update",
  "item.delete",
  "auth.login",
  "auth.logout",
  "agent.create",
  "agent.bootstrap_issue",
  "agent.enroll",
  "agent.rotate",
  "agent.revoke",
  "agent.session_issue",
  "agent.session_reject",
  "agent.session_revoke",
  "permission.create",
  "permission.revoke",
  "access.ciphertext",
  "access.reveal",
  "access.mount_env",
  "access.mount_file",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_RESULTS = ["allowed", "denied", "expired", "revoked"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

/** API key prefixes by agent locality */
export const API_KEY_PREFIX = {
  remote: "abg_",
  local: "abl_",
} as const;

export const AGENT_SESSION_PREFIX = "abs_";
export const AGENT_BOOTSTRAP_PREFIX = "abe_";
export const AGENT_CHALLENGE_PREFIX = "abc_";

export const AGENT_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
export const AGENT_CHALLENGE_TTL_MS = 60 * 1000;
export const AGENT_SESSION_TTL_MS = 15 * 60 * 1000;

/** Locality derived from agent kind */
export function agentLocalityForKind(kind: AgentKind): AgentLocality {
  switch (kind) {
    case "device":
    case "local_cli":
    case "local_mcp":
      return "local";
    case "remote_agent":
      return "remote";
  }
}

export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "VAULT_NOT_FOUND"
  | "VAULT_ALREADY_EXISTS"
  | "ITEM_NOT_FOUND"
  | "AGENT_NOT_FOUND"
  | "AGENT_REVOKED"
  | "AGENT_NOT_ENROLLED"
  | "AGENT_ALREADY_ENROLLED"
  | "AGENT_CHALLENGE_NOT_FOUND"
  | "AGENT_CHALLENGE_EXPIRED"
  | "AGENT_SESSION_NOT_FOUND"
  | "INVALID_BOOTSTRAP_TOKEN"
  | "BOOTSTRAP_TOKEN_EXPIRED"
  | "PERMISSION_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "PERMISSION_EXPIRED"
  | "INVALID_CAPABILITY"
  | "STALE_VERSION"
  | "VALIDATION_ERROR";
