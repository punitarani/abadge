export interface DaemonConfig {
  socketPath?: string;
}

export const DEFAULT_SOCKET_PATH = "~/.abadge/vaultd.sock";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface VaultStatus {
  initialized: boolean;
  locked: boolean;
  itemCount: number;
}

export interface EncryptResult {
  encryptedItemKey: string;
  ciphertext: string;
}

export interface DecryptResult {
  plaintext: string;
}

export interface RunResult {
  exitCode: number;
  signal?: string;
}

/** Alias for daemon exec.env response — same shape as RunResult */
export type ExecEnvResult = RunResult;

export interface ExecMountResult {
  path: string;
}

export interface MountResult {
  path: string;
  cleanup: () => void;
}
