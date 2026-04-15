import type {
  DaemonAuthHeaders,
  DaemonAuthState,
  DaemonAuthStatus,
  EnvExecResult,
  MountExecResult,
  VaultStatus,
} from "@abadge/daemon";
import {
  clearDaemonState,
  DaemonClient,
  type DecryptResult,
  type EncryptResult,
  isDaemonRunning,
  startDaemon,
  stopDaemon,
} from "@abadge/daemon";
import { requireConfig } from "./config";

async function withDaemonClient<T>(run: (client: DaemonClient) => Promise<T>): Promise<T> {
  const client = new DaemonClient();
  return run(client);
}

export async function daemonUnlock(
  profileId: string,
  masterPassword: string,
): Promise<{ ok: boolean; keyVersion: number }> {
  return withDaemonClient((client) => client.unlock(profileId, masterPassword));
}

export async function daemonLock(): Promise<{ ok: boolean }> {
  return withDaemonClient((client) => client.lock());
}

export async function daemonStatus(): Promise<VaultStatus> {
  return withDaemonClient((client) => client.status());
}

export const daemonVaultStatus = daemonStatus;

export async function daemonSetAuthSession(session: DaemonAuthState): Promise<DaemonAuthStatus> {
  return withDaemonClient((client) => client.setAuthSession(session));
}

export async function daemonClearAuthSession(): Promise<DaemonAuthStatus> {
  return withDaemonClient((client) => client.clearAuthSession());
}

export async function daemonAuthStatus(): Promise<DaemonAuthStatus> {
  return withDaemonClient((client) => client.authStatus());
}

export async function daemonAuthHeaders(): Promise<DaemonAuthHeaders> {
  return withDaemonClient((client) => client.authHeaders());
}

export async function daemonChangePassword(
  profileId: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ ok: boolean }> {
  return withDaemonClient((client) => client.changePassword(profileId, oldPassword, newPassword));
}

export async function daemonEncrypt(payload: unknown): Promise<EncryptResult> {
  return withDaemonClient((client) => client.encrypt(payload));
}

export async function daemonDecrypt(
  encryptedItemKey: string,
  ciphertext: string,
): Promise<DecryptResult> {
  return withDaemonClient((client) => client.decrypt(encryptedItemKey, ciphertext));
}

export async function daemonExecEnv(
  secretValue: string,
  envVar: string,
  command: string,
  args: string[],
): Promise<EnvExecResult> {
  return withDaemonClient((client) => client.execEnv(secretValue, envVar, command, args));
}

export async function daemonExpandEnv(
  encryptedItemKey: string | null,
  ciphertext: string | null,
  serverPayload: unknown,
  command: string,
  args: string[],
): Promise<EnvExecResult> {
  return withDaemonClient((client) =>
    client.expandEnv(encryptedItemKey, ciphertext, serverPayload, command, args),
  );
}

export async function daemonExecMount(
  secretValue: string,
  path?: string,
  mode?: number,
): Promise<MountExecResult> {
  return withDaemonClient((client) => client.execMount(secretValue, path, mode));
}

export function daemonProcessRunning(): boolean {
  return isDaemonRunning();
}

export function clearDaemonProcessState(): void {
  clearDaemonState();
}

export function stopDaemonProcess(): boolean {
  return stopDaemon();
}

export function serveDaemon(): void {
  const config = requireConfig();
  startDaemon({
    apiUrl: config.apiUrl,
  });
}
