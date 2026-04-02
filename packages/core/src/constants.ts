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

export const PRINCIPAL_KINDS = ["device", "local_cli", "local_mcp", "remote_agent"] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

export const PRINCIPAL_LOCALITIES = ["local", "remote"] as const;
export type PrincipalLocality = (typeof PRINCIPAL_LOCALITIES)[number];

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
  "principal.create",
  "principal.rotate",
  "principal.revoke",
  "grant.create",
  "grant.revoke",
  "access.ciphertext",
  "access.reveal",
  "access.mount_env",
  "access.mount_file",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_RESULTS = ["allowed", "denied", "expired", "revoked"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

/** API key prefixes by principal locality */
export const API_KEY_PREFIX = {
  remote: "abg_",
  local: "abl_",
} as const;

/** Locality derived from principal kind */
export function localityForKind(kind: PrincipalKind): PrincipalLocality {
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
  | "PRINCIPAL_NOT_FOUND"
  | "PRINCIPAL_REVOKED"
  | "GRANT_NOT_FOUND"
  | "GRANT_DENIED"
  | "GRANT_EXPIRED"
  | "INVALID_CAPABILITY"
  | "STALE_VERSION"
  | "VALIDATION_ERROR";
