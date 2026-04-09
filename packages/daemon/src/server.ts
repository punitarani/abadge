import { chmodSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fromBase64 } from "@abadge/crypto";
import { fetchVaultMeta, updateVaultPassword } from "./api";
import { defaultPidPath, defaultSocketPath } from "./paths";
import type {
  DaemonAuthHeaders,
  DaemonAuthState,
  DaemonAuthStatus,
  DaemonAuthType,
  DaemonConfig,
  EncryptResult,
  EnvExecResult,
  JsonRpcRequest,
  JsonRpcResponse,
  MountExecResult,
  RekeyItemResult,
  VaultStatus,
} from "./types";
import { RPC_ERRORS } from "./types";
import { VaultState } from "./vault-state";

const DEFAULT_AUTO_LOCK_MS = 15 * 60 * 1000;
const MAX_AUTH_SESSION_MS = 24 * 60 * 60 * 1000;

export function resolveConfig(partial: Partial<DaemonConfig>): DaemonConfig {
  return {
    socketPath: partial.socketPath ?? defaultSocketPath(),
    pidPath: partial.pidPath ?? defaultPidPath(),
    autoLockMs: partial.autoLockMs ?? DEFAULT_AUTO_LOCK_MS,
    apiUrl: partial.apiUrl ?? "",
  };
}

const mountedFiles = new Set<string>();

function rpcError(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? 0, error: { code, message } };
}

function rpcOk(id: number | string, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

type RpcHandler = (params: Record<string, unknown>) => Promise<unknown>;

function normalizeAuthType(type: unknown): DaemonAuthType | null {
  return type === "better_auth_session" || type === "operator_token" ? type : null;
}

function isAuthExpired(auth: DaemonAuthState): boolean {
  return new Date(auth.expiresAt).getTime() <= Date.now();
}

function authStatus(auth: DaemonAuthState | null): DaemonAuthStatus {
  if (!auth || isAuthExpired(auth)) {
    return { authenticated: false, type: null, expiresAt: null };
  }

  return {
    authenticated: true,
    type: auth.type,
    expiresAt: auth.expiresAt,
  };
}

function buildAuthHeaders(auth: DaemonAuthState | null): DaemonAuthHeaders {
  if (!auth || isAuthExpired(auth)) {
    throw { code: RPC_ERRORS.AUTH_REQUIRED, message: "Not logged in. Run `abadge login` first." };
  }

  return {
    type: auth.type,
    expiresAt: auth.expiresAt,
    headers:
      auth.type === "operator_token"
        ? { "X-Abadge-Operator-Token": auth.token }
        : { Authorization: `Bearer ${auth.token}` },
  };
}

function resolveAuthExpiry(expiresAt: unknown): string {
  const now = Date.now();
  const capped = now + MAX_AUTH_SESSION_MS;
  const requested =
    typeof expiresAt === "string" && expiresAt ? new Date(expiresAt).getTime() : capped;

  if (!Number.isFinite(requested) || requested <= now) {
    throw { code: RPC_ERRORS.INVALID_PARAMS, message: "expiresAt must be a future ISO timestamp" };
  }

  return new Date(Math.min(requested, capped)).toISOString();
}

function buildHandlers(vault: VaultState, config: DaemonConfig): Record<string, RpcHandler> {
  let auth: DaemonAuthState | null = null;

  return {
    "auth.setSession": async (params): Promise<DaemonAuthStatus> => {
      const token = params.token as string | undefined;
      const type = normalizeAuthType(params.type);
      if (!token || !type) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "token and type are required",
        };
      }

      auth = {
        type,
        token,
        expiresAt: resolveAuthExpiry(params.expiresAt),
      };

      return authStatus(auth);
    },

    "auth.clearSession": async (): Promise<DaemonAuthStatus> => {
      auth = null;
      return authStatus(auth);
    },

    "auth.status": async (): Promise<DaemonAuthStatus> => {
      return authStatus(auth);
    },

    "auth.getHeaders": async (): Promise<DaemonAuthHeaders> => {
      const headers = buildAuthHeaders(auth);
      return headers;
    },

    "vault.unlock": async (params) => {
      const password = params.masterPassword as string | undefined;
      if (!password) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "masterPassword is required" };
      }
      if (!vault.locked) {
        throw { code: RPC_ERRORS.VAULT_ALREADY_UNLOCKED, message: "Vault is already unlocked" };
      }

      const meta = await fetchVaultMeta(config.apiUrl, buildAuthHeaders(auth).headers);
      if (!meta) {
        throw { code: RPC_ERRORS.VAULT_NOT_FOUND, message: "Vault not found — bootstrap first" };
      }

      try {
        vault.unlock(password, meta);
      } catch {
        throw { code: RPC_ERRORS.WRONG_PASSWORD, message: "Wrong master password" };
      }

      return { ok: true, keyVersion: vault.keyVersion };
    },

    "vault.lock": async () => {
      vault.lock();
      return { ok: true };
    },

    "vault.status": async (): Promise<VaultStatus> => {
      return { locked: vault.locked, keyVersion: vault.keyVersion };
    },

    "vault.changePassword": async (params) => {
      const oldPassword = params.oldPassword as string | undefined;
      const newPassword = params.newPassword as string | undefined;
      if (!oldPassword || !newPassword) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "oldPassword and newPassword are required",
        };
      }
      requireUnlocked(vault);

      const meta = await fetchVaultMeta(config.apiUrl, buildAuthHeaders(auth).headers);
      if (!meta) {
        throw { code: RPC_ERRORS.VAULT_NOT_FOUND, message: "Vault not found" };
      }

      let result: { wrappedRootKey: string; kdfSalt: string; kdfParams: unknown };
      try {
        result = vault.changePassword(oldPassword, newPassword, meta);
      } catch {
        throw { code: RPC_ERRORS.WRONG_PASSWORD, message: "Wrong old password" };
      }

      await updateVaultPassword(config.apiUrl, buildAuthHeaders(auth).headers, result);
      return { ok: true };
    },

    "item.encrypt": async (params): Promise<EncryptResult> => {
      const payload = params.payload;
      if (payload === undefined) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "payload is required" };
      }
      requireUnlocked(vault);
      return vault.encrypt(payload);
    },

    "item.decrypt": async (params) => {
      const encryptedItemKey = params.encryptedItemKey as string | undefined;
      const ciphertext = params.ciphertext as string | undefined;
      if (!encryptedItemKey || !ciphertext) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "encryptedItemKey and ciphertext are required",
        };
      }
      requireUnlocked(vault);
      const payload = vault.decrypt(encryptedItemKey, ciphertext);
      return { payload };
    },

    "item.rekey": async (params): Promise<RekeyItemResult[]> => {
      const items = params.items as Array<{ id: string; encryptedItemKey: string }> | undefined;
      const oldRootKeyB64 = params.oldRootKey as string | undefined;
      if (!items || !oldRootKeyB64) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "items and oldRootKey are required" };
      }
      requireUnlocked(vault);
      const oldRootKey = fromBase64(oldRootKeyB64);
      const results = vault.rekey(items, oldRootKey);
      oldRootKey.fill(0);
      return results;
    },

    "exec.env": async (params): Promise<EnvExecResult> => {
      const secretValue = params.secretValue as string | undefined;
      const envVar = params.envVar as string | undefined;
      const command = params.command as string | undefined;
      const args = (params.args as string[]) ?? [];
      if (!secretValue || !envVar || !command) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "secretValue, envVar, and command are required",
        };
      }

      const proc = Bun.spawn([command, ...args], {
        // biome-ignore lint/style/noRestrictedGlobals: daemon needs process.env for subprocess inheritance
        env: { ...process.env, [envVar]: secretValue },
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
      const exitCode = await proc.exited;
      return { exitCode, signal: proc.signalCode ?? undefined };
    },

    "exec.mount": async (params): Promise<MountExecResult> => {
      const secretValue = params.secretValue as string | undefined;
      const targetPath = params.path as string | undefined;
      // mode is never accepted from the caller — always owner-read/write only
      if (!secretValue) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "secretValue is required" };
      }

      const tempPrefix = tmpdir();
      const suffix = crypto.getRandomValues(new Uint8Array(8));
      const hex = Array.from(suffix, (b) => b.toString(16).padStart(2, "0")).join("");
      const filePath = targetPath ? resolve(targetPath) : join(tempPrefix, `abadge-secret-${hex}`);

      if (!filePath.startsWith(`${tempPrefix}/`)) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: `Mount path must be under the system temp directory (${tempPrefix})`,
        };
      }

      writeFileSync(filePath, secretValue, { mode: 0o600 });
      mountedFiles.add(filePath);
      return { path: filePath };
    },

    "exec.cleanup": async (params) => {
      const path = params.path as string | undefined;
      if (!path) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "path is required" };
      }
      if (!mountedFiles.has(path)) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "Path was not mounted by this daemon" };
      }
      mountedFiles.delete(path);
      try {
        rmSync(path);
      } catch {
        // File may already be cleaned up
      }
      return { ok: true };
    },
  };
}

function requireUnlocked(vault: VaultState): void {
  if (vault.locked) {
    throw { code: RPC_ERRORS.VAULT_LOCKED, message: "Vault is locked" };
  }
}

/** Parse and dispatch a single JSON-RPC request. */
async function dispatch(
  raw: string,
  handlers: Record<string, RpcHandler>,
): Promise<JsonRpcResponse> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(raw);
  } catch {
    return rpcError(null, RPC_ERRORS.PARSE_ERROR, "Invalid JSON");
  }

  if (req.jsonrpc !== "2.0" || !req.method || req.id === undefined) {
    return rpcError(req.id ?? null, RPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC request");
  }

  const handler = handlers[req.method];
  if (!handler) {
    return rpcError(req.id, RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${req.method}`);
  }

  try {
    const result = await handler((req.params ?? {}) as Record<string, unknown>);
    return rpcOk(req.id, result);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && "message" in err) {
      const rpcErr = err as { code: number; message: string };
      return rpcError(req.id, rpcErr.code, rpcErr.message);
    }
    const message = err instanceof Error ? err.message : "Internal error";
    return rpcError(req.id, RPC_ERRORS.INTERNAL_ERROR, message);
  }
}

export interface DaemonServer {
  close: () => void;
  vault: VaultState;
}

/**
 * Start the daemon IPC server on a Unix domain socket.
 * Returns a handle for graceful shutdown.
 */
export function startServer(config: DaemonConfig): DaemonServer {
  const vault = new VaultState(config.autoLockMs);
  const handlers = buildHandlers(vault, config);

  vault.setAutoLockCallback(() => {
    console.log("[vaultd] Auto-locked after inactivity");
  });

  mkdirSync(dirname(config.socketPath), { recursive: true });

  // Clean up stale socket file
  try {
    unlinkSync(config.socketPath);
  } catch {
    // Socket file may not exist
  }

  // Buffer for accumulating data per connection
  const connectionBuffers = new WeakMap<object, string>();

  const server = Bun.listen({
    unix: config.socketPath,
    socket: {
      open(socket) {
        connectionBuffers.set(socket, "");
      },
      async data(socket, data) {
        const prev = connectionBuffers.get(socket) ?? "";
        const accumulated = prev + data.toString("utf8");

        // Messages are newline-delimited JSON
        const lines = accumulated.split("\n");
        // Keep the incomplete last line in the buffer
        connectionBuffers.set(socket, lines.pop() ?? "");

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const response = await dispatch(trimmed, handlers);
          socket.write(`${JSON.stringify(response)}\n`);
        }
      },
      close(socket) {
        connectionBuffers.delete(socket);
      },
      error(_socket, error) {
        console.error("[vaultd] Socket error:", error.message);
      },
    },
  });

  // Set socket file permissions to owner-only
  try {
    chmodSync(config.socketPath, 0o600);
  } catch {
    console.warn("[vaultd] Could not set socket permissions to 0600");
  }

  return {
    close() {
      vault.destroy();
      server.stop(true);
      // Clean up mounted files
      for (const path of mountedFiles) {
        try {
          rmSync(path);
        } catch {
          // Best effort
        }
      }
      mountedFiles.clear();
      // Remove socket file
      try {
        unlinkSync(config.socketPath);
      } catch {
        // Already gone
      }
    },
    vault,
  };
}
