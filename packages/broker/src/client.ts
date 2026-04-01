import { createConnection, type Socket } from "node:net";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type {
  DaemonConfig,
  DecryptResult,
  EncryptResult,
  ExecEnvResult,
  ExecMountResult,
  JsonRpcRequest,
  JsonRpcResponse,
  VaultStatus,
} from "./types";
import { DEFAULT_SOCKET_PATH } from "./types";

function resolveSocketPath(socketPath: string): string {
  if (socketPath.startsWith("~")) {
    return resolve(homedir(), socketPath.slice(2));
  }
  return resolve(socketPath);
}

export class DaemonClient {
  private socket: Socket | null = null;
  private nextId = 1;
  private readonly socketPath: string;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();
  private buffer = "";

  constructor(config?: DaemonConfig) {
    this.socketPath = resolveSocketPath(config?.socketPath ?? DEFAULT_SOCKET_PATH);
  }

  async connect(): Promise<void> {
    if (this.socket) return;

    return new Promise<void>((resolve, reject) => {
      const socket = createConnection(this.socketPath);

      socket.on("connect", () => {
        this.socket = socket;
        resolve();
      });

      socket.on("error", (err) => {
        if (!this.socket) {
          reject(new Error(`Failed to connect to daemon at ${this.socketPath}: ${err.message}`));
          return;
        }
        this.rejectAllPending(err);
      });

      socket.on("data", (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      socket.on("close", () => {
        this.socket = null;
        this.rejectAllPending(new Error("Connection closed"));
      });
    });
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.rejectAllPending(new Error("Connection closed"));
  }

  async vaultUnlock(masterPassword: string): Promise<void> {
    await this.call<void>("vault.unlock", { masterPassword });
  }

  async vaultLock(): Promise<void> {
    await this.call<void>("vault.lock");
  }

  async vaultStatus(): Promise<VaultStatus> {
    return this.call<VaultStatus>("vault.status");
  }

  async encrypt(plaintext: string, kind: string): Promise<EncryptResult> {
    return this.call<EncryptResult>("vault.encrypt", { plaintext, kind });
  }

  async decrypt(encryptedItemKey: string, ciphertext: string): Promise<DecryptResult> {
    return this.call<DecryptResult>("vault.decrypt", { encryptedItemKey, ciphertext });
  }

  async execEnv(
    secretValue: string,
    envVar: string,
    command: string,
    args: string[],
  ): Promise<ExecEnvResult> {
    return this.call<ExecEnvResult>("exec.env", { secretValue, envVar, command, args });
  }

  async execMount(secretValue: string, path?: string, mode?: number): Promise<ExecMountResult> {
    return this.call<ExecMountResult>("exec.mount", { secretValue, path, mode });
  }

  async execCleanup(path: string): Promise<void> {
    await this.call<void>("exec.cleanup", { path });
  }

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.socket) {
      throw new Error("Not connected to daemon. Call connect() first.");
    }

    const id = this.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params ? { params } : {}),
    };

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.socket!.write(JSON.stringify(request) + "\n");
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        const pending = this.pending.get(response.id);
        if (!pending) continue;
        this.pending.delete(response.id);

        if (response.error) {
          pending.reject(
            new Error(`Daemon error (${response.error.code}): ${response.error.message}`),
          );
        } else {
          pending.resolve(response.result);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }
}
