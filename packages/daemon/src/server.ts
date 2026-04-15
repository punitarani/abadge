import {
  chmodSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expandFieldSelection, resolveFieldValue } from "@abadge/core";
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

/** Shell-safe env var name: POSIX identifier. */
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Env vars that can alter loader/interpreter behavior of the child process.
 * Injecting these from caller-controlled data would let a malicious or
 * compromised agent hijack subprocess execution (local privilege escalation
 * from agent-level compromise to arbitrary code in the spawned process).
 */
const RESERVED_ENV_KEYS = new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FORCE_FLAT_NAMESPACE",
  "NODE_OPTIONS",
  "BUN_INSTALL",
  "BUN_CONFIG_REGISTRY",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "HOME",
  "USER",
  "SHELL",
  // Node.js bare-import resolution path (analog of PYTHONPATH).
  "NODE_PATH",
  // TLS trust / proxy hijack: redirect or MITM outbound TLS from the child.
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  // Shell loader hijack: alter startup or word-splitting of a spawned shell.
  "BASH_ENV",
  "ENV",
  "IFS",
]);

function validateEnvKey(key: string): void {
  if (!ENV_KEY_PATTERN.test(key)) {
    throw {
      code: RPC_ERRORS.INVALID_PARAMS,
      message: `Invalid env key: ${JSON.stringify(key)}. Must match [A-Z_][A-Z0-9_]*.`,
    };
  }
  if (RESERVED_ENV_KEYS.has(key)) {
    throw {
      code: RPC_ERRORS.INVALID_PARAMS,
      message: `Refusing to inject reserved env var: ${key}`,
    };
  }
}

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
  return type === "better_auth_session" ? type : null;
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
    headers: { Authorization: `Bearer ${auth.token}` },
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

/**
 * Clean up orphaned abadge-* temp directories left behind by crashed sessions.
 * Any entry older than 10 minutes is removed.
 */
async function cleanupOrphanedMounts(): Promise<void> {
  const tmp = tmpdir();
  try {
    const entries = readdirSync(tmp);
    for (const entry of entries) {
      if (!entry.startsWith("abadge-")) continue;
      const fullPath = join(tmp, entry);
      try {
        const stat = statSync(fullPath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs > 10 * 60 * 1000) {
          rmSync(fullPath, { recursive: true, force: true });
        }
      } catch {
        // file already gone
      }
    }
  } catch {
    // tmpdir not accessible
  }
}

function buildHandlers(vault: VaultState, config: DaemonConfig): Record<string, RpcHandler> {
  let auth: DaemonAuthState | null = null;

  return {
    // The daemon does NOT auto-refresh sessions. The CLI is responsible for
    // refreshing the session token and calling auth.setSession with the new
    // token before the stored one expires. The daemon only tracks whether the
    // stored session is expired and surfaces AUTH_REQUIRED errors accordingly.
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
      const profileId = params.profileId as string | undefined;
      if (!password) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "masterPassword is required" };
      }
      if (!profileId) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "profileId is required" };
      }
      if (!vault.locked) {
        throw { code: RPC_ERRORS.VAULT_ALREADY_UNLOCKED, message: "Vault is already unlocked" };
      }

      const meta = await fetchVaultMeta(config.apiUrl, buildAuthHeaders(auth).headers, profileId);
      if (!meta) {
        throw { code: RPC_ERRORS.VAULT_NOT_FOUND, message: "Vault not found — bootstrap first" };
      }

      try {
        vault.unlock(password, meta);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("tag") || msg.includes("decrypt") || msg.includes("auth")) {
          throw { code: RPC_ERRORS.WRONG_PASSWORD, message: "Wrong master password" };
        }
        throw { code: RPC_ERRORS.INTERNAL_ERROR, message: `Unlock failed: ${msg}` };
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
      const profileId = params.profileId as string | undefined;
      if (!oldPassword || !newPassword) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "oldPassword and newPassword are required",
        };
      }
      if (!profileId) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "profileId is required" };
      }
      requireUnlocked(vault);

      const meta = await fetchVaultMeta(config.apiUrl, buildAuthHeaders(auth).headers, profileId);
      if (!meta) {
        throw { code: RPC_ERRORS.VAULT_NOT_FOUND, message: "Vault not found" };
      }

      let result: { wrappedRootKey: string; kdfSalt: string; kdfParams: unknown };
      try {
        result = vault.changePassword(oldPassword, newPassword, meta);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("tag") || msg.includes("decrypt") || msg.includes("auth")) {
          throw { code: RPC_ERRORS.WRONG_PASSWORD, message: "Wrong old password" };
        }
        throw { code: RPC_ERRORS.INTERNAL_ERROR, message: `Password change failed: ${msg}` };
      }

      await updateVaultPassword(
        config.apiUrl,
        buildAuthHeaders(auth).headers,
        profileId,
        result,
      );
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
      const field = params.field as string | undefined;
      if (!encryptedItemKey || !ciphertext) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "encryptedItemKey and ciphertext are required",
        };
      }
      requireUnlocked(vault);
      const payload = vault.decrypt(encryptedItemKey, ciphertext);
      if (field !== undefined) {
        // biome-ignore lint/suspicious/noExplicitAny: payload shape validated at runtime
        const resolved = resolveFieldValue(payload as any, field);
        return { payload: resolved };
      }
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
      validateEnvKey(envVar);

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

    "exec.expandEnv": async (params): Promise<EnvExecResult> => {
      const encryptedItemKey = params.encryptedItemKey as string | undefined;
      const ciphertext = params.ciphertext as string | undefined;
      const serverPayload = params.serverPayload;
      const command = params.command as string | undefined;
      const args = (params.args as string[]) ?? [];
      if (!command) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "command is required" };
      }

      let payload: unknown;
      if (encryptedItemKey && ciphertext) {
        requireUnlocked(vault);
        payload = vault.decrypt(encryptedItemKey, ciphertext);
      } else if (serverPayload !== undefined) {
        payload = serverPayload;
      } else {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "Either encryptedItemKey+ciphertext or serverPayload is required",
        };
      }

      // biome-ignore lint/suspicious/noExplicitAny: payload shape validated at runtime
      const fields = expandFieldSelection(payload as any);
      // biome-ignore lint/suspicious/noExplicitAny: payload shape validated at runtime
      const payloadFields = (payload as any)?.fields ?? {};
      const extraEnv: Record<string, string> = {};
      for (const fieldName of fields) {
        validateEnvKey(fieldName);
        const value = payloadFields[fieldName];
        if (typeof value === "string") {
          extraEnv[fieldName] = value;
        }
      }

      const proc = Bun.spawn([command, ...args], {
        // biome-ignore lint/style/noRestrictedGlobals: daemon needs process.env for subprocess inheritance
        env: { ...process.env, ...extraEnv },
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

  // Clean up temp files left behind by previous crashed sessions
  void cleanupOrphanedMounts();

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

  // Set socket file permissions to owner-only — abort if this fails
  try {
    chmodSync(config.socketPath, 0o600);
  } catch (err) {
    server.stop(true);
    throw new Error(`[vaultd] FATAL: Could not set socket permissions to 0600: ${err}`);
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
