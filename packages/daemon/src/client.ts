import { connect } from "node:net";
import { defaultSocketPath } from "./paths";
import type {
  DaemonAuthHeaders,
  DaemonAuthState,
  DaemonAuthStatus,
  DecryptResult,
  EncryptResult,
  EnvExecResult,
  JsonRpcRequest,
  JsonRpcResponse,
  MountExecResult,
  RekeyItemResult,
  VaultStatus,
} from "./types";

/** Low-level client that sends JSON-RPC requests over a Unix socket. */
export class DaemonClient {
  private socketPath: string;
  private nextId = 1;

  constructor(socketPath?: string) {
    this.socketPath = socketPath ?? defaultSocketPath();
  }

  /** Send a JSON-RPC request and wait for the response. */
  private send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: this.nextId++,
        method,
        params,
      };

      const socket = connect({ path: this.socketPath });
      let buffer = "";

      socket.on("connect", () => {
        socket.write(`${JSON.stringify(req)}\n`);
      });

      socket.on("data", (data) => {
        buffer += data.toString();
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx === -1) return;

        const line = buffer.slice(0, newlineIdx);
        socket.end();

        try {
          const res = JSON.parse(line) as JsonRpcResponse;
          if ("error" in res) {
            const err = new Error(res.error.message) as Error & { code: number };
            err.code = res.error.code;
            reject(err);
          } else {
            resolve(res.result);
          }
        } catch (_e) {
          reject(new Error(`Invalid response from daemon: ${line}`));
        }
      });

      socket.on("error", (err) => {
        reject(new Error(`Cannot connect to vaultd: ${err.message}`));
      });
    });
  }

  /** Store a short-lived bearer session token in daemon memory. */
  async setAuthSession(session: DaemonAuthState): Promise<DaemonAuthStatus> {
    return (await this.send("auth.setSession", { ...session })) as DaemonAuthStatus;
  }

  /** Clear daemon-held session auth. */
  async clearAuthSession(): Promise<DaemonAuthStatus> {
    return (await this.send("auth.clearSession")) as DaemonAuthStatus;
  }

  /** Get daemon-held session auth status. */
  async authStatus(): Promise<DaemonAuthStatus> {
    return (await this.send("auth.status")) as DaemonAuthStatus;
  }

  /** Return request headers for the daemon-held session token. */
  async authHeaders(): Promise<DaemonAuthHeaders> {
    return (await this.send("auth.getHeaders")) as DaemonAuthHeaders;
  }

  /** Unlock the vault with a master password. */
  async unlock(masterPassword: string): Promise<{ ok: boolean; keyVersion: number }> {
    return (await this.send("vault.unlock", { masterPassword })) as {
      ok: boolean;
      keyVersion: number;
    };
  }

  /** Lock the vault, zeroing the root key. */
  async lock(): Promise<{ ok: boolean }> {
    return (await this.send("vault.lock")) as { ok: boolean };
  }

  /** Get vault status. */
  async status(): Promise<VaultStatus> {
    return (await this.send("vault.status")) as VaultStatus;
  }

  /** Change the master password. */
  async changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
    return (await this.send("vault.changePassword", { oldPassword, newPassword })) as {
      ok: boolean;
    };
  }

  /** Encrypt a plaintext value. */
  async encrypt(payload: unknown): Promise<EncryptResult> {
    return (await this.send("item.encrypt", { payload })) as EncryptResult;
  }

  /** Decrypt an encrypted item. */
  async decrypt(encryptedItemKey: string, ciphertext: string): Promise<DecryptResult> {
    return (await this.send("item.decrypt", { encryptedItemKey, ciphertext })) as DecryptResult;
  }

  /** Re-wrap item DEKs with a new root key. */
  async rekey(
    items: Array<{ id: string; encryptedItemKey: string }>,
    oldRootKey: string,
  ): Promise<RekeyItemResult[]> {
    return (await this.send("item.rekey", { items, oldRootKey })) as RekeyItemResult[];
  }

  /** Spawn a subprocess with a secret injected as an environment variable. */
  async execEnv(
    secretValue: string,
    envVar: string,
    command: string,
    args?: string[],
  ): Promise<EnvExecResult> {
    return (await this.send("exec.env", {
      secretValue,
      envVar,
      command,
      args,
    })) as EnvExecResult;
  }

  /** Write a secret to a temporary file (0o600). Returns the file path. */
  async execMount(secretValue: string, path?: string, mode?: number): Promise<MountExecResult> {
    return (await this.send("exec.mount", {
      secretValue,
      path,
      mode,
    })) as MountExecResult;
  }

  /** Delete a mounted temp file. */
  async execCleanup(path: string): Promise<{ ok: boolean }> {
    return (await this.send("exec.cleanup", { path })) as { ok: boolean };
  }

  /**
   * Spawn a subprocess with all item fields injected as environment variables.
   * Decrypts the item if encryptedItemKey+ciphertext are provided, or uses
   * serverPayload directly if the caller already has the decrypted payload.
   */
  async expandEnv(
    encryptedItemKey: string | null,
    ciphertext: string | null,
    serverPayload: unknown,
    command: string,
    args?: string[],
  ): Promise<EnvExecResult> {
    return (await this.send("exec.expandEnv", {
      encryptedItemKey: encryptedItemKey ?? undefined,
      ciphertext: ciphertext ?? undefined,
      serverPayload,
      command,
      args,
    })) as EnvExecResult;
  }
}

/** Convenience wrapper: create a default-socket client and call exec.expandEnv. */
export async function daemonExpandEnv(
  encryptedItemKey: string | null,
  ciphertext: string | null,
  serverPayload: unknown,
  command: string,
  args: string[],
): Promise<{ exitCode: number }> {
  const client = new DaemonClient();
  return client.expandEnv(encryptedItemKey, ciphertext, serverPayload, command, args);
}
