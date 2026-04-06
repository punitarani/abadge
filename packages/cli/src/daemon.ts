import { homedir } from "node:os";
import { join } from "node:path";
import {
  DaemonClient,
  type OperatorSessionConfig,
  type OperatorSessionResult,
} from "@abadge/daemon";

export const SOCKET_PATH = join(homedir(), ".abadge", "vaultd.sock");

interface DaemonResponse {
  ok: boolean;
  error?: string;
  data?: unknown;
}

const DAEMON_ERROR = "Cannot connect to daemon. Is it running? Try `abadge daemon start`.";

async function withDaemon<T>(
  operation: (client: DaemonClient) => Promise<T>,
): Promise<DaemonResponse> {
  const client = new DaemonClient(SOCKET_PATH);

  try {
    const data = await operation(client);
    return { ok: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : DAEMON_ERROR;
    return { ok: false, error: message };
  }
}

export async function daemonStatus(): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.status());
}

export async function daemonSetOperatorSession(
  session: OperatorSessionConfig,
): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.setOperatorSession(session));
}

export async function daemonClearOperatorSession(): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.clearOperatorSession());
}

export async function daemonOperatorStatus(): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.operatorStatus());
}

export async function daemonOperatorToken(): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.operatorToken());
}

export async function daemonUnlock(masterPassword: string): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.unlock(masterPassword));
}

export async function daemonLock(): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.lock());
}

export async function daemonVaultStatus(): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.status());
}

export async function daemonChangePassword(
  oldPassword: string,
  newPassword: string,
): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.changePassword(oldPassword, newPassword));
}

export async function daemonEncrypt(payload: unknown): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.encrypt(payload));
}

export async function daemonDecrypt(
  encryptedItemKey: string,
  ciphertext: string,
): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.decrypt(encryptedItemKey, ciphertext));
}

export async function daemonExecEnv(
  secretValue: string,
  envVar: string,
  command: string,
  args: string[],
): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.execEnv(secretValue, envVar, command, args));
}

export async function daemonExecMount(secretValue: string, path?: string): Promise<DaemonResponse> {
  return withDaemon(async (client) => client.execMount(secretValue, path));
}

export function readOperatorSession(response: DaemonResponse): OperatorSessionResult | null {
  if (!response.ok || !response.data) {
    return null;
  }

  return response.data as OperatorSessionResult;
}
