import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KDFParams } from "@abadge/crypto";
import {
  deriveKEK,
  generateRootKey,
  generateSalt,
  toBase64,
  wrapRootKey,
  zeroKey,
} from "@abadge/crypto";
import { fetchVaultMeta } from "./api";
import { DaemonClient } from "./client";
import { type DaemonServer, resolveConfig, startServer } from "./server";
import type { JsonRpcRequest, JsonRpcResponse, VaultMeta } from "./types";

const servers: DaemonServer[] = [];
const tempDirs: string[] = [];

// Test-only KDF params — the production defaults (64 MiB memory, 3 iterations)
// are far too slow for per-test unlock. These mirror the params used elsewhere
// in the crypto test suite.
const TEST_KDF_PARAMS: KDFParams = {
  algorithm: "argon2id",
  memory: 1024,
  iterations: 1,
  parallelism: 1,
  hashLength: 32,
};

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function allocDaemonDir(): { dir: string; socketPath: string; pidPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "abadge-daemon-"));
  tempDirs.push(dir);
  // mkdtempSync creates the dir at 0o700 on most platforms, but not
  // guaranteed; tighten it so our daemon's parent-dir invariant passes.
  chmodSync(dir, 0o700);
  return {
    dir,
    socketPath: join(dir, "vaultd.sock"),
    pidPath: join(dir, "vaultd.pid"),
  };
}

async function startTestServer(): Promise<{
  client: DaemonClient;
  server: DaemonServer;
  socketPath: string;
}> {
  const { socketPath, pidPath } = allocDaemonDir();
  const server = await startServer(
    resolveConfig({
      socketPath,
      pidPath,
      apiUrl: "http://localhost:8787",
    }),
  );
  servers.push(server);
  return { client: new DaemonClient(socketPath), server, socketPath };
}

/**
 * Build fake vault meta and unlock the in-memory VaultState directly —
 * bypasses `fetchVaultMeta` so tests don't need a live API. Also wires up
 * a short-lived auth session so `exec.*` handlers pass the `buildAuthHeaders`
 * gate that closes W1S6-003.
 */
async function startTestServerUnlocked(): Promise<{
  client: DaemonClient;
  server: DaemonServer;
  socketPath: string;
  password: string;
}> {
  const password = "test-master-password";
  const profileId = "test-profile";
  const salt = generateSalt();
  const kek = deriveKEK(password, salt, TEST_KDF_PARAMS);
  const rootKey = generateRootKey();
  // §W1S7-001 — daemon unlock rebuilds this same AAD; must stay in sync.
  const wrapped = wrapRootKey(rootKey, kek, { profileId, keyVersion: 1 });
  zeroKey(kek);
  zeroKey(rootKey);

  const meta: VaultMeta = {
    id: profileId,
    wrappedRootKey: wrapped.wrapped,
    kdfSalt: toBase64(salt),
    keyVersion: 1,
    kdfParams: TEST_KDF_PARAMS,
  };

  const { client, server, socketPath } = await startTestServer();
  server.vault.unlock(password, meta);

  await client.setAuthSession({
    type: "better_auth_session",
    token: "test-session-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  return { client, server, socketPath, password };
}

/**
 * Send one JSON-RPC request directly over a raw node:net socket. Used by the
 * exec-auth-gate regression tests to verify unauth callers can't spawn
 * subprocesses, without routing through DaemonClient's request helper.
 */
function sendRawRpc(
  socketPath: string,
  request: Omit<JsonRpcRequest, "jsonrpc" | "id"> & { id?: number },
): Promise<JsonRpcResponse> {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect({ path: socketPath });
    const req: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: request.id ?? 1,
      method: request.method,
      params: request.params,
    };
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
        resolvePromise(JSON.parse(line) as JsonRpcResponse);
      } catch (_e) {
        rejectPromise(new Error(`Invalid response from daemon: ${line}`));
      }
    });
    socket.on("error", (err) => {
      rejectPromise(err);
    });
  });
}

describe("daemon auth session state", () => {
  test("keeps bearer-session auth in memory and clears it on request", async () => {
    const { client } = await startTestServer();

    await expect(client.authStatus()).resolves.toEqual({
      authenticated: false,
      type: null,
      expiresAt: null,
    });

    const requestedExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const status = await client.setAuthSession({
      type: "better_auth_session",
      token: "session-token",
      expiresAt: requestedExpiry,
    });

    expect(status.authenticated).toBe(true);
    expect(status.type).toBe("better_auth_session");
    expect(new Date(status.expiresAt ?? 0).getTime()).toBeLessThanOrEqual(
      Date.now() + 24 * 60 * 60 * 1000,
    );
    await expect(client.authHeaders()).resolves.toMatchObject({
      type: "better_auth_session",
      headers: { Authorization: "Bearer session-token" },
    });

    await expect(client.clearAuthSession()).resolves.toEqual({
      authenticated: false,
      type: null,
      expiresAt: null,
    });
    await expect(client.authHeaders()).rejects.toThrow("Not logged in. Run `abadge login` first.");
  });

  test("always returns bearer auth headers for daemon-managed session auth", async () => {
    const { client } = await startTestServer();

    await client.setAuthSession({
      type: "better_auth_session",
      token: "session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(client.authHeaders()).resolves.toMatchObject({
      type: "better_auth_session",
      headers: { Authorization: "Bearer session-token" },
    });
  });

  // §O3 / multi-org CLI — organizationId plumbing regression tests.

  test("auth.setSession accepts and stores organizationId", async () => {
    const { client } = await startTestServer();

    const status = await client.setAuthSession({
      type: "better_auth_session",
      token: "session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      organizationId: "org-abc",
    });

    // setAuthSession returns DaemonAuthStatus — just confirm it is authenticated.
    expect(status.authenticated).toBe(true);
  });

  test("auth.setOrg updates the org scope without re-supplying the token", async () => {
    const { client } = await startTestServer();

    await client.setAuthSession({
      type: "better_auth_session",
      token: "session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      organizationId: "org-old",
    });

    const updated = await client.setAuthOrg("org-new");
    expect(updated.authenticated).toBe(true);
  });

  test("auth.setOrg rejects when session is not set", async () => {
    const { client } = await startTestServer();

    await expect(client.setAuthOrg("org-abc")).rejects.toThrow(/not logged in/i);
  });
});

describe("daemon env-var injection guard", () => {
  test("exec.expandEnv rejects payload with reserved env key PATH", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(null, null, { fields: { PATH: "/evil/bin" } }, "/usr/bin/true", []),
    ).rejects.toThrow("Refusing to inject reserved env var: PATH");
  });

  test("exec.expandEnv rejects payload with reserved env key LD_PRELOAD", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(null, null, { fields: { LD_PRELOAD: "/tmp/evil.so" } }, "/usr/bin/true", []),
    ).rejects.toThrow("Refusing to inject reserved env var: LD_PRELOAD");
  });

  test("exec.expandEnv rejects payload with reserved env key DYLD_INSERT_LIBRARIES", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(
        null,
        null,
        { fields: { DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib" } },
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow("Refusing to inject reserved env var: DYLD_INSERT_LIBRARIES");
  });

  test("exec.expandEnv rejects payload with reserved env key NODE_OPTIONS", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(
        null,
        null,
        { fields: { NODE_OPTIONS: "--require /tmp/evil.js" } },
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow("Refusing to inject reserved env var: NODE_OPTIONS");
  });

  test("exec.expandEnv rejects payload with reserved env key NODE_PATH", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(
        null,
        null,
        { fields: { NODE_PATH: "/tmp/evil-node-modules" } },
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow("Refusing to inject reserved env var: NODE_PATH");
  });

  test("exec.expandEnv rejects payload with reserved env key NODE_EXTRA_CA_CERTS", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(
        null,
        null,
        { fields: { NODE_EXTRA_CA_CERTS: "/tmp/evil-ca.pem" } },
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow("Refusing to inject reserved env var: NODE_EXTRA_CA_CERTS");
  });

  test("exec.expandEnv rejects payload with reserved env key HTTPS_PROXY", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(
        null,
        null,
        { fields: { HTTPS_PROXY: "http://evil.example:8080" } },
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow("Refusing to inject reserved env var: HTTPS_PROXY");
  });

  test("exec.expandEnv rejects payload with reserved env key BASH_ENV", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(
        null,
        null,
        { fields: { BASH_ENV: "/tmp/evil-rc.sh" } },
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow("Refusing to inject reserved env var: BASH_ENV");
  });

  test("exec.expandEnv rejects payload with lowercase field name", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(null, null, { fields: { lowercase: "x" } }, "/usr/bin/true", []),
    ).rejects.toThrow(/Invalid env key.*lowercase/);
  });

  test("exec.expandEnv rejects payload with dashed field name", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(null, null, { fields: { "with-dash": "x" } }, "/usr/bin/true", []),
    ).rejects.toThrow(/Invalid env key.*with-dash/);
  });

  test("exec.expandEnv rejects payload with field name starting with digit", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnv(null, null, { fields: { "123start": "x" } }, "/usr/bin/true", []),
    ).rejects.toThrow(/Invalid env key.*123start/);
  });

  test("exec.expandEnv allows payload with only valid upper-snake field names", async () => {
    const { client } = await startTestServerUnlocked();

    // Use a command that exits 0 quickly so the spawn path succeeds — this
    // confirms validation passed and the call reached Bun.spawn without
    // rejecting on a reserved / invalid key.
    const result = await client.expandEnv(
      null,
      null,
      { fields: { VALID_KEY: "ok", MY_SECRET: "ok" } },
      "/usr/bin/true",
      [],
    );
    expect(result.exitCode).toBe(0);
  });

  test("exec.env rejects envVar PATH with reserved-key error", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(client.execEnv("secret-value", "PATH", "/usr/bin/true", [])).rejects.toThrow(
      "Refusing to inject reserved env var: PATH",
    );
  });

  test("exec.env rejects envVar LD_PRELOAD with reserved-key error", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(client.execEnv("secret-value", "LD_PRELOAD", "/usr/bin/true", [])).rejects.toThrow(
      "Refusing to inject reserved env var: LD_PRELOAD",
    );
  });

  test("exec.env rejects envVar with lowercase characters", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(client.execEnv("secret-value", "lowercase", "/usr/bin/true", [])).rejects.toThrow(
      /Invalid env key.*lowercase/,
    );
  });

  test("exec.env allows envVar MY_SECRET and invokes subprocess", async () => {
    const { client } = await startTestServerUnlocked();

    const result = await client.execEnv("secret-value", "MY_SECRET", "/usr/bin/true", []);
    expect(result.exitCode).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// B26 / COMPOSITE-001 regression tests — cross-UID daemon RCE chain closure.
// -----------------------------------------------------------------------------

describe("daemon socket permissions (W1S6-001 / W3P12-002 / W3P12-003)", () => {
  test("socket file mode is 0o600 atomically after startServer resolves", async () => {
    // biome-ignore lint/style/noRestrictedGlobals: test needs process.umask to set a permissive umask
    const prev = process.umask(0o022);
    try {
      const { socketPath } = await startTestServer();
      const mode = statSync(socketPath).mode & 0o777;
      // The load-bearing assertion for W1S6-001: under a permissive umask,
      // the socket MUST still be 0o600 by the time startServer returns.
      expect(mode).toBe(0o600);
    } finally {
      // biome-ignore lint/style/noRestrictedGlobals: test needs process.umask
      process.umask(prev);
    }
  });

  test("socket parent dir mode is 0o700", async () => {
    const { socketPath } = await startTestServer();
    const parent = join(socketPath, "..");
    const mode = statSync(parent).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("startServer aborts when socket parent dir has wider perms than 0o700", async () => {
    const dir = mkdtempSync(join(tmpdir(), "abadge-daemon-wide-"));
    tempDirs.push(dir);
    const wideParent = join(dir, "wide-abadge");
    mkdirSync(wideParent, { mode: 0o755 });
    // Sanity check — mkdir with explicit mode may still be masked by umask on
    // some platforms; force it to 0o755 so the assertion below is meaningful.
    chmodSync(wideParent, 0o755);

    await expect(
      startServer(
        resolveConfig({
          socketPath: join(wideParent, "vaultd.sock"),
          pidPath: join(wideParent, "vaultd.pid"),
          apiUrl: "http://localhost:8787",
        }),
      ),
    ).rejects.toThrow(/expected 700/);
  });
});

describe("daemon exec.* auth + unlock gate (W1S6-003)", () => {
  test("exec.env without auth rejects with AUTH_REQUIRED and spawns nothing", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "exec.env",
      params: {
        secretValue: "s3cr3t",
        envVar: "MY_SECRET",
        command: "/usr/bin/true",
        args: [],
      },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      // RPC_ERRORS.AUTH_REQUIRED = -32004
      expect(response.error.code).toBe(-32004);
      expect(response.error.message).toMatch(/not logged in/i);
    }
  });

  test("exec.expandEnv without auth rejects with AUTH_REQUIRED even for serverPayload", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "exec.expandEnv",
      params: {
        serverPayload: { fields: { MY_SECRET: "ok" } },
        command: "/usr/bin/true",
        args: [],
      },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32004);
    }
  });

  test("exec.mount without auth rejects with AUTH_REQUIRED", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "exec.mount",
      params: { secretValue: "shhh" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32004);
    }
  });

  test("exec.cleanup without auth rejects with AUTH_REQUIRED", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "exec.cleanup",
      params: { path: "/tmp/whatever" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32004);
    }
  });

  test("exec.env with auth but locked vault rejects with VAULT_LOCKED", async () => {
    const { client } = await startTestServer();

    await client.setAuthSession({
      type: "better_auth_session",
      token: "session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(client.execEnv("secret", "MY_SECRET", "/usr/bin/true", [])).rejects.toThrow(
      /vault is locked/i,
    );
  });

  test("exec.expandEnv with auth but locked vault rejects with VAULT_LOCKED", async () => {
    const { client } = await startTestServer();

    await client.setAuthSession({
      type: "better_auth_session",
      token: "session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(
      client.expandEnv(null, null, { fields: { MY_SECRET: "ok" } }, "/usr/bin/true", []),
    ).rejects.toThrow(/vault is locked/i);
  });
});

describe("daemon strips ABADGE_* from child env (defence-in-depth)", () => {
  test("exec.env subprocess does not see ABADGE_* keys from daemon process.env", async () => {
    const { client } = await startTestServerUnlocked();
    const outFile = join(mkdtempSync(join(tmpdir(), "abadge-env-out-")), "env.txt");
    tempDirs.push(join(outFile, ".."));

    // Set an ABADGE_* key on the daemon's own env, then spawn a child that
    // dumps its env to a file. Child should NOT see ABADGE_TEST_LEAK.
    // biome-ignore lint/style/noRestrictedGlobals: test needs process.env to set a probe var
    process.env.ABADGE_TEST_LEAK = "leaked-value";
    try {
      // Use sh to redirect `env` output to the file (avoids depending on
      // any single binary layout).
      const result = await client.execEnv("injected-secret", "MY_SECRET", "/bin/sh", [
        "-c",
        `env > ${outFile}`,
      ]);
      expect(result.exitCode).toBe(0);

      const contents = await Bun.file(outFile).text();
      // The child should have seen the explicit MY_SECRET pass-through…
      expect(contents).toMatch(/^MY_SECRET=injected-secret$/m);
      // …but MUST NOT see the daemon's ABADGE_* key.
      expect(contents).not.toMatch(/^ABADGE_TEST_LEAK=/m);
      expect(contents).not.toMatch(/^ABADGE_/m);
    } finally {
      // biome-ignore lint/style/noRestrictedGlobals: test cleanup
      delete process.env.ABADGE_TEST_LEAK;
    }
  });
});

// -----------------------------------------------------------------------------
// W3P12-001 / Critical C-2 — identity.sign RPC regression tests.
// -----------------------------------------------------------------------------

describe("daemon identity.sign RPC (W3P12-001)", () => {
  test("returns a valid Ed25519 signature over nonce|sessionStartMs", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "identity.sign",
      params: { nonce: "client-nonce-abc" },
    });
    expect("result" in response).toBe(true);
    if (!("result" in response)) return;

    const result = response.result as {
      signature: string;
      publicKey: string;
      sessionStartMs: number;
    };
    expect(typeof result.signature).toBe("string");
    expect(result.signature.length).toBeGreaterThan(0);
    expect(typeof result.publicKey).toBe("string");
    expect(typeof result.sessionStartMs).toBe("number");

    const { verifyEd25519 } = await import("@abadge/crypto");
    const ok = await verifyEd25519(
      result.publicKey,
      `client-nonce-abc|${result.sessionStartMs}`,
      result.signature,
    );
    expect(ok).toBe(true);
  });

  test("rejects empty nonce with INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "identity.sign",
      params: { nonce: "" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("rejects oversize nonce (> 512 chars) with INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "identity.sign",
      params: { nonce: "x".repeat(513) },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("rejects missing nonce with INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "identity.sign",
      params: {},
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("two consecutive signatures differ — signs the supplied nonce, not a stored constant", async () => {
    const { socketPath } = await startTestServer();
    const a = await sendRawRpc(socketPath, {
      method: "identity.sign",
      params: { nonce: "nonce-a" },
    });
    const b = await sendRawRpc(socketPath, {
      method: "identity.sign",
      params: { nonce: "nonce-b" },
    });
    expect("result" in a && "result" in b).toBe(true);
    if ("result" in a && "result" in b) {
      const ra = a.result as { signature: string };
      const rb = b.result as { signature: string };
      expect(ra.signature).not.toBe(rb.signature);
    }
  });
});

// -----------------------------------------------------------------------------
// §O3 / multi-org CLI — X-Abadge-Org-Id header forwarding in fetchVaultMeta.
// -----------------------------------------------------------------------------

describe("fetchVaultMeta X-Abadge-Org-Id header plumbing (§O3)", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("includes X-Abadge-Org-Id header when organizationId is provided", async () => {
    let capturedOrgHeader: string | undefined;

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      // biome-ignore lint/suspicious/noExplicitAny: HeadersInit not in ES2022 lib
      const h = new Headers(init?.headers as any);
      capturedOrgHeader = h.get("X-Abadge-Org-Id") ?? undefined;
      // Return a valid tRPC batch response for profiles.get
      return new Response(
        JSON.stringify([
          {
            result: {
              data: {
                profile: {
                  id: "prof-1",
                  wrappedRootKey: "wrapped",
                  kdfSalt: "salt",
                  kdfParams: {
                    algorithm: "argon2id",
                    memory: 1024,
                    iterations: 1,
                    parallelism: 1,
                    hashLength: 32,
                  },
                  keyVersion: 1,
                },
              },
            },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    await fetchVaultMeta(
      "http://localhost:8787",
      { Authorization: "Bearer test-token" },
      "prof-1",
      "org-xyz",
    );

    expect(capturedOrgHeader).toBe("org-xyz");
  });

  test("omits X-Abadge-Org-Id header when organizationId is null", async () => {
    let capturedOrgHeader: string | null = null;

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      // biome-ignore lint/suspicious/noExplicitAny: HeadersInit not in ES2022 lib
      const h = new Headers(init?.headers as any);
      capturedOrgHeader = h.get("X-Abadge-Org-Id");
      return new Response(
        JSON.stringify([
          {
            result: {
              data: {
                profile: {
                  id: "prof-2",
                  wrappedRootKey: "wrapped",
                  kdfSalt: "salt",
                  kdfParams: {
                    algorithm: "argon2id",
                    memory: 1024,
                    iterations: 1,
                    parallelism: 1,
                    hashLength: 32,
                  },
                  keyVersion: 1,
                },
              },
            },
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    await fetchVaultMeta(
      "http://localhost:8787",
      { Authorization: "Bearer test-token" },
      "prof-2",
      null,
    );

    expect(capturedOrgHeader).toBeNull();
  });
});
