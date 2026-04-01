import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export const SOCKET_PATH = join(homedir(), ".abadge", "vaultd.sock");

interface DaemonResponse {
  ok: boolean;
  error?: string;
  data?: unknown;
}

const DAEMON_ERROR = "Cannot connect to daemon. Is it running? Try `abadge daemon start`.";

/** Send a JSON-RPC-style message to the daemon over Unix socket and return the response. */
async function call(method: string, params: Record<string, unknown> = {}): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET_PATH);
    const chunks: Buffer[] = [];

    socket.on("connect", () => {
      socket.write(JSON.stringify({ method, params }) + "\n");
    });

    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    socket.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8").trim();
        resolve(JSON.parse(raw) as DaemonResponse);
      } catch {
        reject(new Error("Invalid response from daemon"));
      }
    });

    socket.on("error", () => {
      reject(new Error(DAEMON_ERROR));
    });
  });
}

export async function daemonStatus(): Promise<DaemonResponse> {
  return call("status");
}

export async function daemonUnlock(masterPassword: string): Promise<DaemonResponse> {
  return call("vault.unlock", { masterPassword });
}

export async function daemonLock(): Promise<DaemonResponse> {
  return call("vault.lock");
}

export async function daemonVaultStatus(): Promise<DaemonResponse> {
  return call("vault.status");
}

export async function daemonChangePassword(
  oldPassword: string,
  newPassword: string,
): Promise<DaemonResponse> {
  return call("vault.changePassword", { oldPassword, newPassword });
}

export async function daemonEncrypt(plaintext: string): Promise<DaemonResponse> {
  return call("vault.encrypt", { plaintext });
}

export async function daemonDecrypt(ciphertext: string): Promise<DaemonResponse> {
  return call("vault.decrypt", { ciphertext });
}

export async function daemonExecEnv(itemId: string, command: string[]): Promise<DaemonResponse> {
  return call("exec.env", { itemId, command });
}

export async function daemonExecMount(itemId: string): Promise<DaemonResponse> {
  return call("exec.mount", { itemId });
}
