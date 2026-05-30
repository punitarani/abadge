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
import {
  ENV_VAR_NAME_PATTERN,
  expandFieldSelection,
  labelToEnvKey,
  listStringFields,
  RESERVED_ENV_KEYS,
  resolveFieldValue,
} from "@abadge/core";
import { fromBase64 } from "@abadge/crypto";
import { fetchVaultMeta, updateVaultPassword } from "./api";
import { type DaemonIdentity, loadOrCreateDaemonIdentity, signChallenge } from "./identity";
import { defaultPidPath, defaultSocketPath } from "./paths";
import type {
  BulkExecItem,
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

/**
 * Defense-in-depth ceiling on `exec.envBulk` items. The API (access.bulkMountEnv)
 * already caps at 256; matching the cap here means a tampered CLI that
 * skips the API and goes straight to the daemon still can't blow the
 * Unix-socket newline-delimited JSON buffer. Trust-but-verify.
 */
const BULK_ITEMS_MAX = 256;

// RESERVED_ENV_KEYS and ENV_VAR_NAME_PATTERN come from @abadge/core — the
// single authoritative source shared with the MCP server.

function validateEnvKey(key: string): void {
  if (!ENV_VAR_NAME_PATTERN.test(key)) {
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

function buildHandlers(
  vault: VaultState,
  config: DaemonConfig,
  identity: DaemonIdentity,
): Record<string, RpcHandler> {
  let auth: DaemonAuthState | null = null;

  return {
    // TOFU peer verification. The client calls this BEFORE any sensitive RPC to
    // confirm it is talking to the real daemon and not a same-UID squatter.
    // Un-gated (no auth / unlock check) on purpose: gating it would deadlock the
    // handshake, since auth.setSession runs only AFTER verification.
    "identity.sign": async (params) => {
      const nonce = params.nonce as string | undefined;
      if (!nonce || typeof nonce !== "string") {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "nonce is required" };
      }
      if (nonce.length === 0 || nonce.length > 512) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "nonce must be 1..512 chars",
        };
      }
      const signature = await signChallenge(identity, nonce);
      return {
        signature,
        publicKey: identity.publicKey,
        sessionStartMs: identity.sessionStartMs,
      };
    },

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

      const rawOrgId = params.organizationId;
      const organizationId = typeof rawOrgId === "string" && rawOrgId ? rawOrgId : null;

      auth = {
        type,
        token,
        expiresAt: resolveAuthExpiry(params.expiresAt),
        organizationId,
      };

      return authStatus(auth);
    },

    // Updates the cached org scope without re-supplying the token. Called by
    // `abadge org use` so outbound tRPC calls pick up the new org immediately.
    "auth.setOrg": async (params): Promise<DaemonAuthStatus> => {
      if (!auth || isAuthExpired(auth)) {
        throw {
          code: RPC_ERRORS.AUTH_REQUIRED,
          message: "Not logged in. Run `abadge login` first.",
        };
      }
      const rawOrgId = params.organizationId;
      const organizationId = typeof rawOrgId === "string" && rawOrgId ? rawOrgId : null;
      auth = { ...auth, organizationId };
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

      const meta = await fetchVaultMeta(
        config.apiUrl,
        buildAuthHeaders(auth).headers,
        profileId,
        auth?.organizationId,
      );
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

      const meta = await fetchVaultMeta(
        config.apiUrl,
        buildAuthHeaders(auth).headers,
        profileId,
        auth?.organizationId,
      );
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
        auth?.organizationId,
      );
      return { ok: true };
    },

    "item.encrypt": async (params): Promise<EncryptResult> => {
      const payload = params.payload;
      const profileId = params.profileId as string | undefined;
      const itemId = params.itemId as string | undefined;
      const contentVersionRaw = params.contentVersion;
      const contentVersion =
        typeof contentVersionRaw === "number" && Number.isFinite(contentVersionRaw)
          ? contentVersionRaw
          : undefined;
      if (payload === undefined) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "payload is required" };
      }
      // profileId + itemId are bound into the XChaCha20-Poly1305 AAD. CLI
      // callers MUST pre-generate the itemId (UUID) before calling item.encrypt
      // and pass the same value to items.create.
      if (!profileId || !itemId) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "profileId and itemId are required",
        };
      }
      requireUnlocked(vault);
      return vault.encrypt(payload, { profileId, itemId, contentVersion });
    },

    "item.decrypt": async (params) => {
      const encryptedItemKey = params.encryptedItemKey as string | undefined;
      const ciphertext = params.ciphertext as string | undefined;
      const profileId = params.profileId as string | undefined;
      const itemId = params.itemId as string | undefined;
      const contentVersionRaw = params.contentVersion;
      const contentVersion =
        typeof contentVersionRaw === "number" && Number.isFinite(contentVersionRaw)
          ? contentVersionRaw
          : undefined;
      const field = params.field as string | undefined;
      if (!encryptedItemKey || !ciphertext) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "encryptedItemKey and ciphertext are required",
        };
      }
      // AAD meta is mandatory on decrypt; a missing param would otherwise mask
      // the row-swap detection the AAD is designed to provide.
      if (!profileId || !itemId) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "profileId and itemId are required",
        };
      }
      requireUnlocked(vault);
      const payload = vault.decrypt(encryptedItemKey, ciphertext, {
        profileId,
        itemId,
        contentVersion,
      });
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
      const profileId = params.profileId as string | undefined;
      if (!items || !oldRootKeyB64) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "items and oldRootKey are required" };
      }
      // rekey re-wraps each DEK under the new root key with the DEK-wrap AAD
      // bound to (profileId, itemId). profileId MUST come from the caller, not
      // the currently-unlocked vault meta: during rotation the unlocked vault
      // may represent a different profile than the items being rewrapped (e.g.
      // password-change flows on a staged keyVersion).
      if (!profileId) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: "profileId is required",
        };
      }
      requireUnlocked(vault);
      const oldRootKey = fromBase64(oldRootKeyB64);
      const results = vault.rekey(items, oldRootKey, { profileId });
      oldRootKey.fill(0);
      return results;
    },

    "exec.env": async (params): Promise<EnvExecResult> => {
      // exec.* RPCs are gated on auth + unlock — unauthenticated or pre-unlock
      // callers must not be able to spawn subprocesses as the daemon UID.
      buildAuthHeaders(auth);
      requireUnlocked(vault);

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
        env: { ...buildChildEnv(), [envVar]: secretValue },
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
      const exitCode = await proc.exited;
      return { exitCode, signal: proc.signalCode ?? undefined };
    },

    "exec.expandEnv": async (params): Promise<EnvExecResult> => {
      // Auth + unlock gate before any decrypt or subprocess spawn — applies to
      // both the ZK and server-managed branches below.
      buildAuthHeaders(auth);
      requireUnlocked(vault);

      const encryptedItemKey = params.encryptedItemKey as string | undefined;
      const ciphertext = params.ciphertext as string | undefined;
      const serverPayload = params.serverPayload;
      const command = params.command as string | undefined;
      const args = (params.args as string[]) ?? [];
      const profileId = params.profileId as string | undefined;
      const itemId = params.itemId as string | undefined;
      const contentVersionRaw = params.contentVersion;
      const contentVersion =
        typeof contentVersionRaw === "number" && Number.isFinite(contentVersionRaw)
          ? contentVersionRaw
          : undefined;
      if (!command) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "command is required" };
      }

      let payload: unknown;
      if (encryptedItemKey && ciphertext) {
        // ZK decrypt requires the AAD meta so the XChaCha20-Poly1305 tag check
        // binds to the same (profile, item, contentVersion) the row was stored
        // under.
        if (!profileId || !itemId) {
          throw {
            code: RPC_ERRORS.INVALID_PARAMS,
            message: "profileId and itemId are required for ZK expandEnv",
          };
        }
        payload = vault.decrypt(encryptedItemKey, ciphertext, {
          profileId,
          itemId,
          contentVersion,
        });
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
        env: { ...buildChildEnv(), ...extraEnv },
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
      const exitCode = await proc.exited;
      return { exitCode, signal: proc.signalCode ?? undefined };
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: exec.envBulk decrypts N items (ZK + SM), validates labels → env-key normalization, detects reserved-key + collision violations, builds env map, and spawns a subprocess — splitting it would scatter the audit/cleanup paths.
    "exec.envBulk": async (params): Promise<EnvExecResult> => {
      // Auth + unlock gate (matches exec.expandEnv).
      buildAuthHeaders(auth);
      requireUnlocked(vault);

      const items = params.items as BulkExecItem[] | undefined;
      const command = params.command as string | undefined;
      const args = (params.args as string[]) ?? [];
      if (!command) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "command is required" };
      }
      if (!Array.isArray(items)) {
        throw { code: RPC_ERRORS.INVALID_PARAMS, message: "items must be an array" };
      }
      // Defense-in-depth: the API caps at 256, but trust-but-verify here so
      // a misbehaving CLI can't DoS the daemon by stuffing the socket buffer.
      if (items.length > BULK_ITEMS_MAX) {
        throw {
          code: RPC_ERRORS.INVALID_PARAMS,
          message: `items exceeds limit of ${BULK_ITEMS_MAX}`,
        };
      }

      const envMap: Record<string, string> = {};
      // Track which item produced which env var so a collision error names
      // both items, not just the second one.
      const envSource: Record<string, { itemId: string; label: string }> = {};

      for (const item of items) {
        if (!item || typeof item !== "object") {
          throw { code: RPC_ERRORS.INVALID_PARAMS, message: "Malformed bulk item entry" };
        }
        if (!item.itemId || !item.label || !item.storageMode) {
          throw {
            code: RPC_ERRORS.INVALID_PARAMS,
            message: "Each bulk item requires itemId, label, and storageMode",
          };
        }
        const storageMode: unknown = item.storageMode;
        if (storageMode !== "zero_knowledge" && storageMode !== "server_managed") {
          // Reject malformed input early so the discriminated narrowing below
          // is sound even when the cast at the param boundary lied.
          throw {
            code: RPC_ERRORS.INVALID_PARAMS,
            message: `Unknown storage mode '${String(storageMode)}' for item ${item.itemId}`,
          };
        }

        let payload: unknown;
        if (item.storageMode === "zero_knowledge") {
          if (!item.encryptedItemKey || !item.ciphertext || !item.profileId) {
            throw {
              code: RPC_ERRORS.INVALID_PARAMS,
              message: `ZK bulk item ${item.itemId} missing encryptedItemKey/ciphertext/profileId`,
            };
          }
          // Re-bind XChaCha20-Poly1305 AAD to (profileId, itemId, contentVersion)
          // so a row-substitution attack (replacing item A's ciphertext with B's)
          // fails the tag check.
          payload = vault.decrypt(item.encryptedItemKey, item.ciphertext, {
            profileId: item.profileId,
            itemId: item.itemId,
            contentVersion: item.contentVersion,
          });
        } else {
          payload = item.payload;
        }

        // Structural filter: only items with exactly one string field
        // participate in --all. 0-field items are silently skipped (no useful
        // injection target). Multi-field items (login/certificate/ssh_key)
        // are silently skipped — user opts in per-item with --field.
        // biome-ignore lint/suspicious/noExplicitAny: payload shape validated by callers
        const stringFields = listStringFields(payload as any);
        if (stringFields.length !== 1) continue;

        // biome-ignore lint/suspicious/noExplicitAny: same — caller-validated shape
        const fields = (payload as any)?.fields as Record<string, unknown> | undefined;
        const fieldName = stringFields[0] as string;
        const fieldValue = fields?.[fieldName];
        if (typeof fieldValue !== "string") continue;

        const envKey = labelToEnvKey(item.label);
        if (envKey.length === 0) {
          throw {
            code: RPC_ERRORS.INVALID_PARAMS,
            message: `Item label '${item.label}' (id=${item.itemId}) cannot be normalized into a valid env var name`,
          };
        }
        if (RESERVED_ENV_KEYS.has(envKey)) {
          // Hard-reject. Silent-skip would launch the user's app with the
          // wrong env (e.g. parent's PATH instead of "leaked" PATH from a
          // secret manager) which is a footgun.
          throw {
            code: RPC_ERRORS.INVALID_PARAMS,
            message: `Item label '${item.label}' (id=${item.itemId}) normalizes to reserved env var '${envKey}'. Rename the item or exclude it.`,
          };
        }
        if (!ENV_VAR_NAME_PATTERN.test(envKey)) {
          throw {
            code: RPC_ERRORS.INVALID_PARAMS,
            message: `Item label '${item.label}' (id=${item.itemId}) produces invalid env var '${envKey}'`,
          };
        }
        const existing = envSource[envKey];
        if (existing) {
          throw {
            code: RPC_ERRORS.INVALID_PARAMS,
            message: `Env var collision on '${envKey}': items ${existing.itemId} ('${existing.label}') and ${item.itemId} ('${item.label}'). Rename one of them.`,
          };
        }
        envMap[envKey] = fieldValue;
        envSource[envKey] = { itemId: item.itemId, label: item.label };
      }

      const proc = Bun.spawn([command, ...args], {
        env: { ...buildChildEnv(), ...envMap },
        stdout: "inherit",
        stderr: "inherit",
        stdin: "inherit",
      });
      const exitCode = await proc.exited;
      return { exitCode, signal: proc.signalCode ?? undefined };
    },

    "exec.mount": async (params): Promise<MountExecResult> => {
      // Auth + unlock gate.
      buildAuthHeaders(auth);
      requireUnlocked(vault);

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
      // Auth + unlock gate: cleanup removes files that only an authenticated,
      // unlocked operator could have created via exec.mount.
      buildAuthHeaders(auth);
      requireUnlocked(vault);

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

/**
 * Build the base environment for a daemon-spawned subprocess.
 *
 * Strips every ABADGE_* key from the daemon's own process.env before
 * inheritance — defence-in-depth so daemon-side config (API URL, tokens, etc.)
 * is not leaked into arbitrary child commands. The explicit secret pass-through
 * is layered on top by the caller.
 */
function buildChildEnv(): Record<string, string | undefined> {
  const childEnv: Record<string, string | undefined> = {};
  // biome-ignore lint/style/noRestrictedGlobals: daemon needs process.env for subprocess inheritance
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("ABADGE_")) {
      childEnv[k] = v;
    }
  }
  return childEnv;
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
export async function startServer(config: DaemonConfig): Promise<DaemonServer> {
  const vault = new VaultState(config.autoLockMs);

  vault.setAutoLockCallback(() => {
    console.log("[vaultd] Auto-locked after inactivity");
  });

  // Clean up temp files left behind by previous crashed sessions
  void cleanupOrphanedMounts();

  // The parent dir MUST be 0700. If it already exists with wider perms (e.g. a
  // prior install under a permissive umask, or a cross-UID attacker
  // pre-creating it), fail early rather than silently tightening with chmod,
  // which would paper over the real issue.
  const socketDir = dirname(config.socketPath);
  mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  const dirMode = statSync(socketDir).mode & 0o777;
  if (dirMode !== 0o700) {
    throw new Error(
      `[vaultd] FATAL: Socket parent dir ${socketDir} has perms ${dirMode.toString(8)}, expected 700`,
    );
  }

  // Load or create the daemon's Ed25519 keypair BEFORE the socket accepts
  // connections, so the `identity.sign` handler has the identity in memory the
  // first time a client calls it for TOFU fingerprint pinning.
  const identity = await loadOrCreateDaemonIdentity(socketDir);
  const handlers = buildHandlers(vault, config, identity);

  // Clean up stale socket file
  try {
    unlinkSync(config.socketPath);
  } catch {
    // Socket file may not exist
  }

  // Buffer for accumulating data per connection
  const connectionBuffers = new WeakMap<object, string>();

  // Atomic socket permissions. `Bun.listen({ unix })` creates the socket inode
  // under the process umask. With the default umask 0022 the socket would
  // briefly exist at mode 0755, giving a cross-UID attacker with an
  // inotify/fsevents watcher a deterministic window to connect before a
  // follow-up chmod runs. Temporarily set umask to 0o077 so the socket is
  // created at 0o600 atomically, then restore the previous umask in finally{}.
  // biome-ignore lint/style/noRestrictedGlobals: daemon needs process.umask for atomic socket creation
  const previousUmask = process.umask(0o077);
  let server: ReturnType<typeof Bun.listen>;
  try {
    server = Bun.listen({
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
  } finally {
    // biome-ignore lint/style/noRestrictedGlobals: daemon needs process.umask for atomic socket creation
    process.umask(previousUmask);
  }

  // Belt-and-suspenders: the umask-at-listen above already creates the socket
  // at 0o600. chmodSync corrects any platform where umask didn't apply to the
  // unix inode; the statSync invariant below is the load-bearing guarantee.
  try {
    chmodSync(config.socketPath, 0o600);
  } catch (err) {
    server.stop(true);
    throw new Error(`[vaultd] FATAL: Could not set socket permissions to 0600: ${err}`);
  }

  // Invariant: socket must be exactly mode 0o600 before we return. Any
  // deviation means the atomic-create path failed and someone else's
  // permissions leaked through — abort startup rather than accept the risk.
  const socketMode = statSync(config.socketPath).mode & 0o777;
  if (socketMode !== 0o600) {
    server.stop(true);
    throw new Error(`[vaultd] FATAL: Socket perms ${socketMode.toString(8)} != 0600 after chmod`);
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
