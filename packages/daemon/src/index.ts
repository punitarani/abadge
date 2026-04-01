export { DaemonClient } from "./client";
export { isDaemonRunning, startDaemon, stopDaemon } from "./lifecycle";
export type {
  DaemonConfig,
  EncryptResult,
  EnvExecResult,
  JsonRpcRequest,
  JsonRpcResponse,
  MountExecResult,
  RekeyItemResult,
  VaultStatus,
} from "./types";
