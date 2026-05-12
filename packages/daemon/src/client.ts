import { connect } from "node:net";
import { generateOpaqueToken, verifyEd25519 } from "@abadge/crypto";
import { computeFingerprint } from "./identity";
import { defaultSocketPath } from "./paths";
import type {
  BulkExecItem,
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
  "exec.envBulk",
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
  /**
   * Explicit acknowledgment that this DaemonClient will perform Ed25519
   * signature verification on every session BUT will NOT persist or check a
   * pinned fingerprint across sessions. Required when the pinning callbacks
   * are omitted. Use ONLY for tests, one-shot scripts, or dev tools — never
   * for user-facing CLI paths.
   */
  skipPersistentPinning?: true;
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
   *
   * Plain-string / undefined path: back-compat for tests and one-shot scripts.
   * Still performs Ed25519 signature verification on every sensitive call, but
   * does NOT persist or check a pinned fingerprint across sessions.
   *
   * Options bag: if pinning callbacks are omitted, `skipPersistentPinning: true`
   * is required — prevents production code from silently downgrading to no-pin
   * TOFU by accidentally dropping the callback keys.
   */
  constructor(options?: string | DaemonClientOptions) {
    if (typeof options === "string" || options === undefined) {
      // Plain-string / undefined back-compat path: no pinning callbacks, no
      // explicit opt-in. Still safe for single-session tests and dev tools but
      // should NEVER appear in user-facing CLI/MCP production paths. Callers
      // who want to stay on this path with an options bag must pass
      // `skipPersistentPinning: true`.
      this.socketPath = options ?? defaultSocketPath();
      this.onMismatch = defaultMismatchError;
      return;
    }
    this.socketPath = options.socketPath ?? defaultSocketPath();
    this.getPinnedFingerprint = options.getPinnedFingerprint;
    this.onFirstContact = options.onFirstContact;
    this.onMismatch = options.onMismatch ?? defaultMismatchError;
    // Options-bag path: if pinning callbacks are omitted, require explicit
    // `skipPersistentPinning: true`. This prevents production code from
    // silently downgrading to no-pin by simply dropping the callback keys.
    if (
      !options.getPinnedFingerprint &&
      !options.onFirstContact &&
      options.skipPersistentPinning !== true
    ) {
      throw new Error(
        "DaemonClient: pinning callbacks (getPinnedFingerprint + onFirstContact) are required. " +
          "Pass { skipPersistentPinning: true } to explicitly acknowledge no-pin mode (tests / dev tools).",
      );
    }
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

  /**
   * Encrypt a plaintext value. §W1S7-001: the caller MUST pre-generate the
   * itemId and know the target profileId so both can be bound into the
   * XChaCha20-Poly1305 AAD.
   */
  async encrypt(
    payload: unknown,
    meta: { profileId: string; itemId: string; contentVersion?: number },
  ): Promise<EncryptResult> {
    return (await this.send("item.encrypt", { payload, ...meta })) as EncryptResult;
  }

  /**
   * Decrypt an encrypted item. §W1S7-001: `meta` MUST exactly match the values
   * bound at encrypt time, otherwise the AEAD tag verification fails.
   */
  async decrypt(
    encryptedItemKey: string,
    ciphertext: string,
    meta: { profileId: string; itemId: string; contentVersion?: number },
  ): Promise<DecryptResult> {
    return (await this.send("item.decrypt", {
      encryptedItemKey,
      ciphertext,
      ...meta,
    })) as DecryptResult;
  }

  /**
   * Re-wrap item DEKs with a new root key. §W1S7-001: profileId is carried
   * alongside the items so the daemon can bind the DEK-wrap AAD for each item.
   */
  async rekey(
    items: Array<{ id: string; encryptedItemKey: string }>,
    oldRootKey: string,
    meta: { profileId: string },
  ): Promise<RekeyItemResult[]> {
    return (await this.send("item.rekey", {
      items,
      oldRootKey,
      ...meta,
    })) as RekeyItemResult[];
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
   *
   * §W1S7-001: when encryptedItemKey+ciphertext are provided, `zkMeta` MUST
   * also be provided so the daemon can rebuild the XChaCha20-Poly1305 AAD.
   * Pass `null` in the server-managed (serverPayload) case.
   */
  async expandEnv(
    encryptedItemKey: string | null,
    ciphertext: string | null,
    serverPayload: unknown,
    command: string,
    args?: string[],
    zkMeta?: { profileId: string; itemId: string; contentVersion: number } | null,
  ): Promise<EnvExecResult> {
    return (await this.send("exec.expandEnv", {
      encryptedItemKey: encryptedItemKey ?? undefined,
      ciphertext: ciphertext ?? undefined,
      serverPayload,
      command,
      args,
      profileId: zkMeta?.profileId,
      itemId: zkMeta?.itemId,
      contentVersion: zkMeta?.contentVersion,
    })) as EnvExecResult;
  }

  /**
   * Spawn a subprocess with env vars derived from many items at once.
   * Each item is either a ZK envelope (decrypted in-process via XChaCha20-Poly1305
   * with AAD bound to profileId+itemId+contentVersion) or a server-managed
   * payload pre-decrypted by the API. The daemon normalizes each item's label
   * into a POSIX-shaped env var name, applies the structural filter (single
   * string field), and hard-rejects on collisions or reserved names.
   *
   * Used by `abadge run --all`. Cap of 256 items is enforced server-side.
   */
  async expandEnvBulk(
    items: BulkExecItem[],
    command: string,
    args?: string[],
  ): Promise<EnvExecResult> {
    return (await this.send("exec.envBulk", {
      items,
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
  zkMeta?: { profileId: string; itemId: string; contentVersion: number } | null,
): Promise<{ exitCode: number }> {
  // Pass `options` directly: if undefined, the constructor takes the back-compat
  // string/undefined path (no pinning, still verifies signatures). Spreading
  // `options ?? {}` would produce an empty options bag which now requires
  // `skipPersistentPinning: true` — passing undefined preserves back-compat.
  const client = new DaemonClient(options ? { ...options } : undefined);
  return client.expandEnv(encryptedItemKey, ciphertext, serverPayload, command, args, zkMeta);
}
