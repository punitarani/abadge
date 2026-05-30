import type { KDFParams } from "@abadge/crypto";

/** Daemon configuration. */
export interface DaemonConfig {
  /** Path to the Unix domain socket. Defaults to ~/.abadge/vaultd.sock */
  socketPath: string;
  /** Path to the PID file. Defaults to ~/.abadge/vaultd.pid */
  pidPath: string;
  /** Auto-lock timeout in milliseconds. Defaults to 15 minutes. */
  autoLockMs: number;
  /** API base URL for fetching vault metadata. */
  apiUrl: string;
}

export type DaemonAuthType = "better_auth_session";

export interface DaemonAuthState {
  type: DaemonAuthType;
  token: string;
  expiresAt: string;
  /** Scopes outbound tRPC calls to this org. */
  organizationId?: string | null;
}

export interface DaemonAuthStatus {
  authenticated: boolean;
  type: DaemonAuthType | null;
  expiresAt: string | null;
}

export interface DaemonAuthHeaders {
  headers: Record<string, string>;
  type: DaemonAuthType;
  expiresAt: string;
}

/**
 * Profile metadata fetched from the API (`profiles.get`) for daemon-side ZK
 * operations. `id` is the profile id; the wrapped root key, KDF salt, and KDF
 * params let the daemon derive the KEK and unwrap the root key locally.
 */
export interface VaultMeta {
  id: string;
  wrappedRootKey: string;
  kdfSalt: string;
  keyVersion: number;
  kdfParams: KDFParams;
}

/** JSON-RPC 2.0 request. */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 success response. */
export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: number | string;
  result: unknown;
}

/** JSON-RPC 2.0 error response. */
export interface JsonRpcError {
  jsonrpc: "2.0";
  id: number | string | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

/** Vault status returned by vault.status. */
export interface VaultStatus {
  locked: boolean;
  keyVersion: number;
}

/** Result of item.encrypt. */
export interface EncryptResult {
  encryptedItemKey: string;
  ciphertext: string;
}

/** Result of item.decrypt. */
export interface DecryptResult {
  payload: unknown;
}

/** Result of exec.mount. */
export interface MountExecResult {
  path: string;
}

/** Result of exec.env. */
export interface EnvExecResult {
  exitCode: number;
  signal?: string;
}

/**
 * One item passed to `exec.envBulk`. The daemon decrypts ZK items in-process
 * (using the AAD meta to rebuild the XChaCha20-Poly1305 binding) and
 * passes server-managed payloads through verbatim.
 *
 * The label is the item's user-facing name; the daemon normalizes it to a
 * shell-safe env var name via `labelToEnvKey` from `@abadge/core`.
 */
export type BulkExecItem =
  | {
      itemId: string;
      label: string;
      storageMode: "zero_knowledge";
      encryptedItemKey: string;
      ciphertext: string;
      profileId: string;
      contentVersion: number;
    }
  | {
      itemId: string;
      label: string;
      storageMode: "server_managed";
      payload: unknown;
    };

/** Result of item.rekey for a single item. */
export interface RekeyItemResult {
  id: string;
  newEncryptedItemKey: string;
}

/** Standard JSON-RPC error codes. */
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Custom: vault is locked when it needs to be unlocked. */
  VAULT_LOCKED: -32000,
  /** Custom: vault is already unlocked. */
  VAULT_ALREADY_UNLOCKED: -32001,
  /** Custom: wrong password. */
  WRONG_PASSWORD: -32002,
  /** Custom: vault not bootstrapped. */
  VAULT_NOT_FOUND: -32003,
  /** Custom: an operator session is required. */
  AUTH_REQUIRED: -32004,
} as const;
