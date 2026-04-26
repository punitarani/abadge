import type {
  BulkExecItem,
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
import {
  loadConfig,
  readPinnedDaemonFingerprint,
  requireConfig,
  writePinnedDaemonFingerprint,
} from "./config";

/**
 * Build a DaemonClient wired with the CLI's persistent-pin storage. The
 * handshake callbacks route through the CLI config so TOFU pinning survives
 * restarts — the daemon package itself deliberately doesn't import CLI
 * storage to keep the layering clean (W3P12-001 / Critical C-2).
 */
function createClient(): DaemonClient {
  return new DaemonClient({
    getPinnedFingerprint: readPinnedDaemonFingerprint,
    onFirstContact: async (fingerprint) => {
      const config = loadConfig();
      console.warn(`[abadge] Pinned daemon identity: ${fingerprint}`);
      if (!config) {
        // Pre-login: no config file yet, so the pin can't be persisted now.
        // The Ed25519 signature still verifies this session; the pin will be
        // written on the next sensitive call once `saveConfig({ apiUrl })`
        // runs (login flow).
        console.warn(
          "[abadge] Config not yet initialised; fingerprint will be persisted after login.",
        );
        return;
      }
      await writePinnedDaemonFingerprint(fingerprint, config.apiUrl);
    },
  });
}

async function withDaemonClient<T>(run: (client: DaemonClient) => Promise<T>): Promise<T> {
  const client = createClient();
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

export async function daemonSetAuthOrg(organizationId: string | null): Promise<DaemonAuthStatus> {
  return withDaemonClient((client) => client.setAuthOrg(organizationId));
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

export async function daemonEncrypt(
  payload: unknown,
  meta: { profileId: string; itemId: string; contentVersion?: number },
): Promise<EncryptResult> {
  return withDaemonClient((client) => client.encrypt(payload, meta));
}

export async function daemonDecrypt(
  encryptedItemKey: string,
  ciphertext: string,
  meta: { profileId: string; itemId: string; contentVersion?: number },
): Promise<DecryptResult> {
  return withDaemonClient((client) => client.decrypt(encryptedItemKey, ciphertext, meta));
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
  zkMeta?: { profileId: string; itemId: string; contentVersion: number } | null,
): Promise<EnvExecResult> {
  return withDaemonClient((client) =>
    client.expandEnv(encryptedItemKey, ciphertext, serverPayload, command, args, zkMeta),
  );
}

export async function daemonExpandEnvBulk(
  items: BulkExecItem[],
  command: string,
  args: string[],
): Promise<EnvExecResult> {
  return withDaemonClient((client) => client.expandEnvBulk(items, command, args));
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

export async function serveDaemon(): Promise<void> {
  const config = requireConfig();
  await startDaemon({
    apiUrl: config.apiUrl,
  });
}
