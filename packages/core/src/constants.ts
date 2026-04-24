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

export const AGENT_KINDS = ["local_cli", "local_mcp", "remote"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const AGENT_LOCALITIES = ["local", "remote"] as const;
export type AgentLocality = (typeof AGENT_LOCALITIES)[number];

export const AGENT_AUTH_METHODS = ["public_key_session", "legacy_api_key"] as const;
export type AgentAuthMethod = (typeof AGENT_AUTH_METHODS)[number];

export const CAPABILITIES = [
  "read_ciphertext",
  "reveal_plaintext",
  "mount_env",
  "mount_file",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const AUDIT_EVENT_TYPES = [
  // profile events
  "profile.create",
  "profile.read",
  "profile.bootstrap",
  "profile.rotate",
  "profile.delete",
  "profile.delete_cascade",
  "profile.setup_recovery",
  // item events
  "item.create",
  "item.read",
  "item.update",
  "item.delete",
  "item.delete_cascade",
  "item.export",
  // auth events
  "auth.login",
  "auth.logout",
  "auth.signup",
  "auth.token_issue",
  "auth.token_revoke",
  // org events
  "org.create",
  "org.read",
  "org.update",
  "org.delete",
  "org.member_add",
  "org.member_list",
  "org.member_remove",
  "org.member_role_change",
  "org.invite",
  "org.invite_accept",
  "org.invite_reject",
  "org.invite_revoke",
  // agent events
  "agent.create",
  "agent.bootstrap_issue",
  "agent.enroll",
  "agent.rotate",
  "agent.revoke",
  "agent.revoke_cascade",
  "agent.session_issue",
  "agent.session_reject",
  "agent.session_revoke",
  // permission events
  "permission.create",
  "permission.revoke",
  "permission.revoke_cascade",
  // access events
  "access.ciphertext",
  "access.reveal",
  "access.mount_env",
  "access.mount_file",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_RESULTS = ["allowed", "denied", "expired", "revoked", "cascade"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const STANDARD_FIELDS_BY_KIND = {
  login: ["username", "email", "password", "url", "totp_secret"],
  api_key: ["value", "key_id", "key_secret"],
  token: ["value"],
  json: [],
  certificate: ["cert", "key", "chain", "passphrase"],
  ssh_key: ["private_key", "public_key", "passphrase"],
  opaque: ["value"],
} as const satisfies Record<ItemKind, readonly string[]>;

export const CAPABILITY_MATRIX = {
  local: {
    zero_knowledge: ["read_ciphertext", "mount_env", "mount_file"],
    server_managed: ["reveal_plaintext", "mount_env", "mount_file"],
  },
  remote: {
    zero_knowledge: [],
    server_managed: ["reveal_plaintext"],
  },
} as const satisfies Record<AgentLocality, Record<StorageMode, readonly Capability[]>>;

export function getAllowedCapabilities(
  locality: AgentLocality,
  storageMode: StorageMode,
): readonly Capability[] {
  return CAPABILITY_MATRIX[locality][storageMode];
}

export function isCapabilityAllowed(
  capability: Capability,
  locality: AgentLocality,
  storageMode: StorageMode,
): boolean {
  return getAllowedCapabilities(locality, storageMode).includes(capability);
}

/** API key prefixes by agent locality */
export const API_KEY_PREFIX = {
  remote: "abg_",
  local: "abl_",
} as const;

export const AGENT_SESSION_PREFIX = "abs_";
export const AGENT_BOOTSTRAP_PREFIX = "abe_";
export const AGENT_CHALLENGE_PREFIX = "abc_";
export const INVITE_TOKEN_PREFIX = "abi_";

export const AGENT_BOOTSTRAP_TTL_MS = 10 * 60 * 1000;
export const AGENT_CHALLENGE_TTL_MS = 60 * 1000;
export const AGENT_SESSION_TTL_MS = 15 * 60 * 1000;
export const AGENT_SESSION_REFRESH_BUFFER_MS = 2 * 60 * 1000;
export const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** §AGC1a — Maximum agents per organization. */
export const MAX_AGENTS_PER_ORG = 500;

/** §AGC1b — Maximum serialized JSON bytes for agent metadata. */
export const MAX_AGENT_METADATA_JSON_BYTES = 16 * 1024; // 16 KB

/** §AGC1b — Maximum nesting depth for agent metadata JSON. */
export const MAX_AGENT_METADATA_DEPTH = 8;

/** Locality derived from agent kind */
export function agentLocalityForKind(kind: AgentKind | "device" | "remote_agent"): AgentLocality {
  switch (kind) {
    case "local_cli":
    case "local_mcp":
    case "device":
      return "local";
    case "remote":
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
  | "ITEM_ALREADY_EXISTS"
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
  | "PERMISSION_ALREADY_EXISTS"
  | "PERMISSION_DENIED"
  | "PERMISSION_EXPIRED"
  | "INVALID_CAPABILITY"
  | "INVALID_CAPABILITY_LOCALITY"
  | "INVALID_CAPABILITY_STORAGE"
  | "PUBLIC_KEY_REQUIRED"
  | "ENROLLMENT_REQUIRED"
  | "STALE_VERSION"
  | "FIELD_NOT_FOUND"
  | "MULTI_FIELD_ITEM"
  | "PROFILE_NOT_FOUND"
  | "PROFILE_ALREADY_EXISTS"
  | "PROFILE_NOT_EMPTY"
  | "ROTATE_KEY_INCOMPLETE"
  | "ORG_NOT_EMPTY"
  | "SLUG_TAKEN"
  | "ITEM_DELETED"
  | "MEMBER_INSUFFICIENT_ROLE"
  | "MEMBER_AGENT_OWNERSHIP"
  | "ORG_HEADER_REQUIRED"
  | "NO_ORG_MEMBERSHIP"
  | "ORG_MEMBERSHIP_REQUIRED"
  | "INVITE_NOT_FOUND"
  | "INVITE_EXPIRED"
  | "INVITE_ALREADY_USED"
  | "ALREADY_MEMBER"
  | "VALIDATION_ERROR"
  | "INTEGRITY_ERROR"
  | "SESSION_REFRESH_FAILED";
