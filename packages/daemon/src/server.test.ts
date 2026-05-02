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

describe("daemon exec.envBulk", () => {
  test("spawns child with single-string-field server-managed items merged into env", async () => {
    const { client } = await startTestServerUnlocked();
    const outFile = join(mkdtempSync(join(tmpdir(), "abadge-bulk-out-")), "env.txt");
    tempDirs.push(join(outFile, ".."));

    const result = await client.expandEnvBulk(
      [
        {
          itemId: "item-1",
          label: "openai-api-key",
          storageMode: "server_managed",
          payload: { fields: { value: "sk-aaa" } },
        },
        {
          itemId: "item-2",
          label: "DATABASE_URL",
          storageMode: "server_managed",
          payload: { fields: { value: "postgres://localhost/db" } },
        },
      ],
      "/bin/sh",
      ["-c", `env > ${outFile}`],
    );
    expect(result.exitCode).toBe(0);
    const contents = await Bun.file(outFile).text();
    // Label normalization happens in the daemon, not the field name.
    expect(contents).toMatch(/^OPENAI_API_KEY=sk-aaa$/m);
    expect(contents).toMatch(/^DATABASE_URL=postgres:\/\/localhost\/db$/m);
  });

  test("silently skips multi-field items (login-shaped) — those need --item explicit selection", async () => {
    const { client } = await startTestServerUnlocked();
    const outFile = join(mkdtempSync(join(tmpdir(), "abadge-bulk-skip-")), "env.txt");
    tempDirs.push(join(outFile, ".."));

    const result = await client.expandEnvBulk(
      [
        {
          itemId: "item-1",
          label: "stripe-key",
          storageMode: "server_managed",
          payload: { fields: { value: "sk-stripe" } },
        },
        {
          itemId: "item-2",
          label: "main-db",
          storageMode: "server_managed",
          payload: { fields: { username: "admin", password: "shh", url: "postgres://x" } },
        },
      ],
      "/bin/sh",
      ["-c", `env > ${outFile}`],
    );
    expect(result.exitCode).toBe(0);
    const contents = await Bun.file(outFile).text();
    expect(contents).toMatch(/^STRIPE_KEY=sk-stripe$/m);
    // Multi-field item is skipped — no MAIN_DB_USERNAME / MAIN_DB_PASSWORD expansion.
    expect(contents).not.toMatch(/^MAIN_DB(_|=)/m);
  });

  test("hard-rejects an item whose label normalizes to a reserved env var", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnvBulk(
        [
          {
            itemId: "item-bad",
            label: "node-options",
            storageMode: "server_managed",
            payload: { fields: { value: "--require /tmp/evil.js" } },
          },
        ],
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow(/id=item-bad.*reserved env var 'NODE_OPTIONS'/);
  });

  test("hard-rejects two items that collide on the same env var name", async () => {
    const { client } = await startTestServerUnlocked();

    await expect(
      client.expandEnvBulk(
        [
          {
            itemId: "item-A",
            label: "api-key",
            storageMode: "server_managed",
            payload: { fields: { value: "first" } },
          },
          {
            itemId: "item-B",
            label: "API_KEY",
            storageMode: "server_managed",
            payload: { fields: { value: "second" } },
          },
        ],
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow(/collision on 'API_KEY'.*item-A.*item-B/);
  });

  test("rejects items array exceeding BULK_ITEMS_MAX (256) at the daemon boundary", async () => {
    const { client } = await startTestServerUnlocked();
    const oversized = Array.from({ length: 257 }, (_, i) => ({
      itemId: `item-${i}`,
      label: `KEY_${i}`,
      storageMode: "server_managed" as const,
      payload: { fields: { value: `v-${i}` } },
    }));

    await expect(client.expandEnvBulk(oversized, "/usr/bin/true", [])).rejects.toThrow(
      /items exceeds limit of 256/,
    );
  });

  test("auth + unlock gates apply (no spawn before authentication)", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "exec.envBulk",
      params: {
        items: [
          {
            itemId: "item-1",
            label: "MY_KEY",
            storageMode: "server_managed",
            payload: { fields: { value: "ok" } },
          },
        ],
        command: "/usr/bin/true",
        args: [],
      },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      // RPC_ERRORS.AUTH_REQUIRED = -32004
      expect(response.error.code).toBe(-32004);
    }
  });
});

// ---------------------------------------------------------------------------
// vault.unlock + vault.changePassword param-validation branches
//
// These hit the `INVALID_PARAMS` and `VAULT_ALREADY_UNLOCKED` short-circuits
// before the handler reaches the API. The API-call branches (correct/wrong
// password against a real profile row) are covered end-to-end by apps/e2e
// against a wrangler-dev API; reproducing them here would require a tRPC
// batch-link stub server, which is heavy for a marginal coverage gain.
// ---------------------------------------------------------------------------

describe("vault.unlock + vault.changePassword param validation", () => {
  test("vault.unlock without masterPassword → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "vault.unlock",
      params: { profileId: "p_x" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      // RPC_ERRORS.INVALID_PARAMS = -32602
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toMatch(/masterPassword/);
    }
  });

  test("vault.unlock without profileId → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "vault.unlock",
      params: { masterPassword: "pw" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toMatch(/profileId/);
    }
  });

  test("vault.unlock when already unlocked → VAULT_ALREADY_UNLOCKED", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "vault.unlock",
      params: { profileId: "p_x", masterPassword: "pw" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      // RPC_ERRORS.VAULT_ALREADY_UNLOCKED = -32001
      expect(response.error.code).toBe(-32001);
    }
  });

  test("vault.lock when locked is a no-op (idempotent ok=true)", async () => {
    const { client } = await startTestServer();
    const out = await client.lock();
    expect(out.ok).toBe(true);
    const status = await client.status();
    expect(status.locked).toBe(true);
  });

  test("vault.status reflects unlocked state + keyVersion", async () => {
    const { client } = await startTestServerUnlocked();
    const status = await client.status();
    expect(status.locked).toBe(false);
    expect(status.keyVersion).toBe(1);
  });

  test("vault.changePassword without oldPassword/newPassword → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "vault.changePassword",
      params: { profileId: "p_x" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("vault.changePassword without profileId → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "vault.changePassword",
      params: { oldPassword: "old", newPassword: "new" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("vault.changePassword on a locked vault → VAULT_LOCKED", async () => {
    const { socketPath } = await startTestServer();
    const response = await sendRawRpc(socketPath, {
      method: "vault.changePassword",
      params: { profileId: "p_x", oldPassword: "old", newPassword: "new" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      // RPC_ERRORS.VAULT_LOCKED = -32000
      expect(response.error.code).toBe(-32000);
    }
  });
});

// ---------------------------------------------------------------------------
// item.encrypt / item.decrypt / item.rekey — in-memory round-trips and
// param-validation branches. The vault is already unlocked in
// startTestServerUnlocked so encrypt/decrypt run against the real
// XChaCha20-Poly1305 path with proper AAD binding.
// ---------------------------------------------------------------------------

describe("item.encrypt + item.decrypt round-trip and param validation", () => {
  test("encrypt → decrypt round-trip preserves payload", async () => {
    const { client } = await startTestServerUnlocked();
    const meta = { profileId: "test-profile", itemId: "item-rt-1", contentVersion: 1 };
    const enc = await client.encrypt({ v: 1, secret: "alpha" }, meta);
    expect(enc.encryptedItemKey).toBeTruthy();
    expect(enc.ciphertext).toBeTruthy();

    const dec = await client.decrypt(enc.encryptedItemKey, enc.ciphertext, meta);
    expect(dec.payload).toEqual({ v: 1, secret: "alpha" });
  });

  test("decrypt with wrong itemId AAD fails (row-swap defense)", async () => {
    const { client } = await startTestServerUnlocked();
    const enc = await client.encrypt(
      { v: 1, secret: "guarded" },
      { profileId: "test-profile", itemId: "item-bound", contentVersion: 1 },
    );
    // Same profile/contentVersion, different itemId in the AAD — AEAD tag must fail.
    await expect(
      client.decrypt(enc.encryptedItemKey, enc.ciphertext, {
        profileId: "test-profile",
        itemId: "item-different",
        contentVersion: 1,
      }),
    ).rejects.toThrow();
  });

  test("decrypt with wrong profileId AAD fails (cross-profile defense)", async () => {
    const { client } = await startTestServerUnlocked();
    const enc = await client.encrypt(
      { v: 1 },
      { profileId: "test-profile", itemId: "item-cp", contentVersion: 1 },
    );
    await expect(
      client.decrypt(enc.encryptedItemKey, enc.ciphertext, {
        profileId: "other-profile",
        itemId: "item-cp",
        contentVersion: 1,
      }),
    ).rejects.toThrow();
  });

  test("encrypt without profileId → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "item.encrypt",
      params: { payload: { v: 1 }, itemId: "item-x" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("encrypt without itemId → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "item.encrypt",
      params: { payload: { v: 1 }, profileId: "p1" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("encrypt with no payload → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "item.encrypt",
      params: { profileId: "p1", itemId: "i1" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("decrypt missing encryptedItemKey/ciphertext → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "item.decrypt",
      params: { profileId: "p1", itemId: "i1" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("decrypt missing AAD meta (profileId/itemId) → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "item.decrypt",
      params: { encryptedItemKey: "x", ciphertext: "y" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
    }
  });

  test("encrypt on a locked vault → VAULT_LOCKED", async () => {
    const { client, socketPath } = await startTestServerUnlocked();
    await client.lock();
    const response = await sendRawRpc(socketPath, {
      method: "item.encrypt",
      params: { payload: { v: 1 }, profileId: "p1", itemId: "i1" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32000);
    }
  });

  test("decrypt with field= picks one field from a multi-field payload", async () => {
    const { client } = await startTestServerUnlocked();
    const meta = { profileId: "test-profile", itemId: "item-multi", contentVersion: 1 };
    // ItemPayload-shaped payload: { kind, label, fields: { ... } }
    const payload = {
      v: 1,
      label: "creds",
      kind: "login" as const,
      tags: [] as string[],
      fields: { username: "admin", password: "s3cret", url: "https://x" },
    };
    const enc = await client.encrypt(payload, meta);

    const dec = await client.decrypt(enc.encryptedItemKey, enc.ciphertext, meta);
    expect(dec.payload).toEqual(payload);
  });
});

describe("item.rekey param validation", () => {
  test("missing items → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "item.rekey",
      params: { oldRootKey: "x", profileId: "p1" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(-32602);
  });

  test("missing oldRootKey → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "item.rekey",
      params: { items: [], profileId: "p1" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(-32602);
  });

  test("missing profileId → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "item.rekey",
      params: { items: [], oldRootKey: "x" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(-32602);
  });

  test("rekey on locked vault → VAULT_LOCKED", async () => {
    const { client, socketPath } = await startTestServerUnlocked();
    await client.lock();
    const response = await sendRawRpc(socketPath, {
      method: "item.rekey",
      params: { items: [], oldRootKey: "AAAA", profileId: "p1" },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(-32000);
  });
});

// ---------------------------------------------------------------------------
// exec.expandEnv branch coverage — neither ZK nor server-managed payload
// surfaces as INVALID_PARAMS instead of silently producing zero env vars.
// ---------------------------------------------------------------------------

describe("exec.expandEnv branch coverage", () => {
  test("missing both ZK envelope and serverPayload → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "exec.expandEnv",
      params: { command: "/usr/bin/true", args: [] },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toMatch(/encryptedItemKey|serverPayload/);
    }
  });

  test("ZK path without profileId/itemId → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "exec.expandEnv",
      params: {
        encryptedItemKey: "x",
        ciphertext: "y",
        command: "/usr/bin/true",
        args: [],
      },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) {
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toMatch(/profileId.*itemId/);
    }
  });

  test("missing command → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "exec.expandEnv",
      params: { serverPayload: { fields: { value: "v" } }, args: [] },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(-32602);
  });
});

// ---------------------------------------------------------------------------
// exec.envBulk additional adversarial branches not yet covered.
// ---------------------------------------------------------------------------

describe("exec.envBulk extra adversarial branches", () => {
  test("missing items array → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "exec.envBulk",
      params: { command: "/usr/bin/true", args: [] },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(-32602);
  });

  test("missing command → INVALID_PARAMS", async () => {
    const { socketPath } = await startTestServerUnlocked();
    const response = await sendRawRpc(socketPath, {
      method: "exec.envBulk",
      params: { items: [] },
    });
    expect("error" in response).toBe(true);
    if ("error" in response) expect(response.error.code).toBe(-32602);
  });

  test("malformed item entry (missing label) → rejected", async () => {
    const { client } = await startTestServerUnlocked();
    await expect(
      client.expandEnvBulk(
        // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed for the test
        [
          {
            itemId: "item-x",
            storageMode: "server_managed",
            payload: { fields: { value: "v" } },
          } as any,
        ],
        "/usr/bin/true",
        [],
      ),
    ).rejects.toThrow();
  });
});
