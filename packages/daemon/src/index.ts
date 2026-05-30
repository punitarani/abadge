export { DaemonClient } from "./client";
export { type DaemonErrorKind, daemonErrorKind } from "./error-kind";
export { clearDaemonState, isDaemonRunning, startDaemon, stopDaemon } from "./lifecycle";
export type {
  BulkExecItem,
  DaemonAuthHeaders,
  DaemonAuthState,
  DaemonAuthStatus,
  DaemonAuthType,
  DaemonConfig,
  DecryptResult,
  EncryptResult,
  EnvExecResult,
  JsonRpcRequest,
  JsonRpcResponse,
  MountExecResult,
  RekeyItemResult,
  VaultStatus,
} from "./types";
export { RPC_ERRORS } from "./types";
