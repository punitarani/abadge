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

// `public_key_session` (Ed25519 keypair → short-lived `abs_` session tokens) is
// the only agent auth method. The former `legacy_api_key` method (`abl_`/`abg_`
// long-lived keys) was fully removed; programmatic secret access now always goes
// through keypair-backed agent sessions. The column stays a single-value enum so
// the public `Agent` shape is unchanged.
export const AGENT_AUTH_METHODS = ["public_key_session"] as const;
export type AgentAuthMethod = (typeof AGENT_AUTH_METHODS)[number];

export const CAPABILITIES = [
  // §RM-PR1 — Canonical capabilities (post-collapse).
  "read",
  "use",
  // Legacy capabilities — still accepted on the wire and stored in existing
  // rows; mapped to canonical at access-time via `LEGACY_TO_CANONICAL`.
  "read_ciphertext",
  "reveal_plaintext",
  "mount_env",
  "mount_file",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Canonical capabilities — the only shape new code should produce. `read`
 * covers both ciphertext-only and plaintext reveal access; `use` covers env
 * and file mount delivery. Locality + storage-mode constraints are enforced
 * at the access boundary rather than encoded in the capability name.
 */
export const CANONICAL_CAPABILITIES = ["read", "use"] as const satisfies readonly Capability[];

/**
 * Legacy capabilities — retained because existing `permissions` rows already
 * use these names, and existing access procedures key off them. New writes
 * should prefer the canonical pair.
 */
export const LEGACY_CAPABILITIES = [
  "read_ciphertext",
  "reveal_plaintext",
  "mount_env",
  "mount_file",
] as const satisfies readonly Capability[];

/**
 * Maps each legacy capability to its canonical equivalent. Used by the
 * upcoming unified access pipeline to evaluate legacy grants and canonical
 * grants under one rule set.
 */
export const LEGACY_TO_CANONICAL: Record<(typeof LEGACY_CAPABILITIES)[number], Capability> = {
  read_ciphertext: "read",
  reveal_plaintext: "read",
  mount_env: "use",
  mount_file: "use",
};

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
  // personal user API key events (management-surface credentials, prefix `abu_`)
  "user_api_key.create",
  "user_api_key.revoke",
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

/**
 * @deprecated As of the §RM-PR1 capability collapse, runtime legality of an
 * access attempt is determined by the unified access pipeline (locality +
 * storage mode + canonical capability), not by lookup in this table. The
 * matrix is retained only for the legacy access endpoints during the
 * deprecation window and will be removed once those endpoints are deleted.
 */
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

/**
 * Delivery modes for the canonical `use` capability. Locality + storage-mode
 * still restrict which mode is acceptable for a given (agent, item) pair;
 * those checks live in the access pipeline.
 */
export const DELIVERY_MODES = ["env", "file"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

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

export const AGENT_SESSION_PREFIX = "abs_";
export const AGENT_BOOTSTRAP_PREFIX = "abe_";
export const AGENT_CHALLENGE_PREFIX = "abc_";
export const INVITE_TOKEN_PREFIX = "abi_";
/**
 * Personal user API key prefix. An `abu_` token is bound to a (user, org) pair
 * and authenticates the management surface only — it resolves to a session
 * identity and can never reach the agent-gated `access.*` surface, so it cannot
 * reveal or mount secret values.
 */
export const USER_API_KEY_PREFIX = "abu_";

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

/**
 * Organization "type" stored in the existing `organization.metadata` text
 * column. A personal org is a single-user workspace presented in the UI as a
 * personal account rather than an organization. There is no dedicated schema
 * column — the flag rides in `metadata` as the JSON string below.
 */
export const ORG_TYPE_PERSONAL = "personal" as const;

/**
 * Exact serialized string written to `organization.metadata` for personal
 * orgs. Kept as one literal so the seed-time write and read-time parse cannot
 * drift apart.
 */
export const PERSONAL_ORG_METADATA = `{"type":"${ORG_TYPE_PERSONAL}"}` as const;

/** True iff `metadata` marks the org as a personal workspace. Malformed JSON,
 * null, arrays, and non-personal types all return false. */
export function isPersonalOrg(metadata: string | null | undefined): boolean {
  if (!metadata) return false;
  try {
    const parsed: unknown = JSON.parse(metadata);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as { type?: unknown }).type === ORG_TYPE_PERSONAL
    );
  } catch {
    return false;
  }
}

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
  | "SESSION_REFRESH_FAILED"
  | "MOUNT_NOT_FOUND";
