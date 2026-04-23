import { connect } from "node:net";
import { generateOpaqueToken, verifyEd25519 } from "@abadge/crypto";
import { computeFingerprint } from "./identity";
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

/**
 * Methods that touch the operator's master password, Better Auth bearer, or
 * plaintext secrets. These MUST pass the TOFU handshake before the frame is
 * written to the socket — otherwise a same-UID squatter would silently
 * capture credentials (W3P12-001 / Critical C-2).
 */
const SENSITIVE_RPC_METHODS = new Set<string>([
  "auth.setSession",
  "auth.setOrg",
  "vault.unlock",
  "vault.changePassword",
  "item.encrypt",
  "item.decrypt",
  "item.rekey",
  "exec.env",
  "exec.expandEnv",
  "exec.mount",
]);

export interface DaemonIdentityCallbacks {
  /** Read the pinned daemon fingerprint from persistent storage. */
  getPinnedFingerprint?: () => Promise<string | null>;
  /** Called exactly once when a new fingerprint is pinned (TOFU). */
  onFirstContact?: (fingerprint: string) => Promise<void>;
  /** Build the mismatch error. Default: a loud Error. */
  onMismatch?: (expected: string, actual: string) => Error;
}

export interface DaemonClientOptions extends DaemonIdentityCallbacks {
  socketPath?: string;
}

function defaultMismatchError(expected: string, actual: string): Error {
  return new Error(
    `DAEMON_IDENTITY_CHANGED: expected ${expected}, got ${actual}.\n` +
      "If this was unexpected, your machine may be compromised. Investigate before re-pinning.\n" +
      "To re-pin: delete the daemonFingerprint field from ~/.abadge/config.json.",
  );
}

/** Low-level client that sends JSON-RPC requests over a Unix socket. */
export class DaemonClient {
  private socketPath: string;
  private nextId = 1;
  private verifiedFingerprint: string | null = null;
  private getPinnedFingerprint?: () => Promise<string | null>;
  private onFirstContact?: (fingerprint: string) => Promise<void>;
  private onMismatch: (expected: string, actual: string) => Error;
  private verifyInFlight: Promise<string> | null = null;

  /**
   * Accepts either a plain socket path (back-compat) or a full options bag.
   * When callbacks are omitted the handshake is still performed but mismatches
   * fall back to the default hard-fail — callers that can't plumb pinned
   * storage (tests, one-shot scripts) still benefit from signature verification
   * even without persistent pinning.
   */
  constructor(options?: string | DaemonClientOptions) {
    if (typeof options === "string" || options === undefined) {
      this.socketPath = options ?? defaultSocketPath();
    } else {
      this.socketPath = options.socketPath ?? defaultSocketPath();
      this.getPinnedFingerprint = options.getPinnedFingerprint;
      this.onFirstContact = options.onFirstContact;
      this.onMismatch = options.onMismatch ?? defaultMismatchError;
      return;
    }
    this.onMismatch = defaultMismatchError;
  }

  /**
   * Perform the TOFU handshake: send `identity.sign` with a fresh nonce,
   * verify the Ed25519 signature, then check the fingerprint against storage
   * (pin on first contact, hard-fail on mismatch). Cached for the lifetime of
   * the DaemonClient instance to amortize across multiple sensitive calls.
   */
  private async ensureVerified(method: string): Promise<void> {
    if (!SENSITIVE_RPC_METHODS.has(method)) return;
    if (this.verifiedFingerprint !== null) return;

    // Guard against parallel sensitive calls racing the handshake. The first
    // caller performs the RPC; everyone else awaits the in-flight promise.
    if (!this.verifyInFlight) {
      this.verifyInFlight = this.performHandshake().finally(() => {
        this.verifyInFlight = null;
      });
    }
    const fingerprint = await this.verifyInFlight;
    this.verifiedFingerprint = fingerprint;
  }

  private async performHandshake(): Promise<string> {
    const nonce = generateOpaqueToken("abn_");
    const result = (await this.sendRaw("identity.sign", { nonce })) as {
      signature?: unknown;
      publicKey?: unknown;
      sessionStartMs?: unknown;
    };
    const signature = typeof result.signature === "string" ? result.signature : null;
    const publicKey = typeof result.publicKey === "string" ? result.publicKey : null;
    const sessionStartMs = typeof result.sessionStartMs === "number" ? result.sessionStartMs : null;
    if (!signature || !publicKey || sessionStartMs === null) {
      throw new Error("DAEMON_IDENTITY_VERIFICATION_FAILED: malformed identity.sign response");
    }
    const ok = await verifyEd25519(publicKey, `${nonce}|${sessionStartMs}`, signature);
    if (!ok) {
      throw new Error("DAEMON_IDENTITY_VERIFICATION_FAILED: signature check failed");
    }
    const fingerprint = await computeFingerprint(publicKey);

    const pinned = this.getPinnedFingerprint ? await this.getPinnedFingerprint() : null;
    if (pinned === null) {
      if (this.onFirstContact) {
        await this.onFirstContact(fingerprint);
      }
    } else if (pinned !== fingerprint) {
      throw this.onMismatch(pinned, fingerprint);
    }
    return fingerprint;
  }

  /** Send a JSON-RPC request and wait for the response (gated by handshake). */
  private async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    await this.ensureVerified(method);
    return this.sendRaw(method, params);
  }

  /** Send a JSON-RPC request without handshake gating (used by handshake itself). */
  private sendRaw(method: string, params?: Record<string, unknown>): Promise<unknown> {
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

  /**
   * Update the cached org scope without re-supplying the token.
   * Called after `abadge org use` so outbound tRPC calls pick up the new
   * org immediately without a full re-login (§O3 / multi-org CLI fix).
   */
  async setAuthOrg(organizationId: string | null): Promise<DaemonAuthStatus> {
    return (await this.send("auth.setOrg", { organizationId })) as DaemonAuthStatus;
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

  /** Unlock a profile's vault with its master password. */
  async unlock(
    profileId: string,
    masterPassword: string,
  ): Promise<{ ok: boolean; keyVersion: number }> {
    return (await this.send("vault.unlock", { profileId, masterPassword })) as {
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

  /** Change a profile's master password. */
  async changePassword(
    profileId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<{ ok: boolean }> {
    return (await this.send("vault.changePassword", {
      profileId,
      oldPassword,
      newPassword,
    })) as {
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
  options?: DaemonIdentityCallbacks,
): Promise<{ exitCode: number }> {
  const client = new DaemonClient({ ...(options ?? {}) });
  return client.expandEnv(encryptedItemKey, ciphertext, serverPayload, command, args);
}
