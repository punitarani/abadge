export { DaemonClient } from "./client";
export { clearDaemonState, isDaemonRunning, startDaemon, stopDaemon } from "./lifecycle";
export type {
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
