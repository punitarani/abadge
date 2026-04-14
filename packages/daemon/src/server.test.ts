import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonClient } from "./client";
import { type DaemonServer, resolveConfig, startServer } from "./server";

const servers: DaemonServer[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function startTestServer(): { client: DaemonClient } {
  const dir = mkdtempSync(join(tmpdir(), "abadge-daemon-"));
  tempDirs.push(dir);
  const socketPath = join(dir, "vaultd.sock");
  const server = startServer(
    resolveConfig({
      socketPath,
      pidPath: join(dir, "vaultd.pid"),
      apiUrl: "http://localhost:8787",
    }),
  );
  servers.push(server);
  return { client: new DaemonClient(socketPath) };
}

describe("daemon auth session state", () => {
  test("keeps bearer-session auth in memory and clears it on request", async () => {
    const { client } = startTestServer();

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
    const { client } = startTestServer();

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
});

describe("daemon env-var injection guard", () => {
  test("exec.expandEnv rejects payload with reserved env key PATH", async () => {
    const { client } = startTestServer();

    await expect(
      client.expandEnv(null, null, { fields: { PATH: "/evil/bin" } }, "/usr/bin/true", []),
    ).rejects.toThrow("Refusing to inject reserved env var: PATH");
  });

  test("exec.expandEnv rejects payload with reserved env key LD_PRELOAD", async () => {
    const { client } = startTestServer();

    await expect(
      client.expandEnv(null, null, { fields: { LD_PRELOAD: "/tmp/evil.so" } }, "/usr/bin/true", []),
    ).rejects.toThrow("Refusing to inject reserved env var: LD_PRELOAD");
  });

  test("exec.expandEnv rejects payload with reserved env key DYLD_INSERT_LIBRARIES", async () => {
    const { client } = startTestServer();

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
    const { client } = startTestServer();

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
    const { client } = startTestServer();

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
    const { client } = startTestServer();

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
    const { client } = startTestServer();

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
    const { client } = startTestServer();

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
    const { client } = startTestServer();

    await expect(
      client.expandEnv(null, null, { fields: { lowercase: "x" } }, "/usr/bin/true", []),
    ).rejects.toThrow(/Invalid env key.*lowercase/);
  });

  test("exec.expandEnv rejects payload with dashed field name", async () => {
    const { client } = startTestServer();

    await expect(
      client.expandEnv(null, null, { fields: { "with-dash": "x" } }, "/usr/bin/true", []),
    ).rejects.toThrow(/Invalid env key.*with-dash/);
  });

  test("exec.expandEnv rejects payload with field name starting with digit", async () => {
    const { client } = startTestServer();

    await expect(
      client.expandEnv(null, null, { fields: { "123start": "x" } }, "/usr/bin/true", []),
    ).rejects.toThrow(/Invalid env key.*123start/);
  });

  test("exec.expandEnv allows payload with only valid upper-snake field names", async () => {
    const { client } = startTestServer();

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
    const { client } = startTestServer();

    await expect(client.execEnv("secret-value", "PATH", "/usr/bin/true", [])).rejects.toThrow(
      "Refusing to inject reserved env var: PATH",
    );
  });

  test("exec.env rejects envVar LD_PRELOAD with reserved-key error", async () => {
    const { client } = startTestServer();

    await expect(client.execEnv("secret-value", "LD_PRELOAD", "/usr/bin/true", [])).rejects.toThrow(
      "Refusing to inject reserved env var: LD_PRELOAD",
    );
  });

  test("exec.env rejects envVar with lowercase characters", async () => {
    const { client } = startTestServer();

    await expect(client.execEnv("secret-value", "lowercase", "/usr/bin/true", [])).rejects.toThrow(
      /Invalid env key.*lowercase/,
    );
  });

  test("exec.env allows envVar MY_SECRET and invokes subprocess", async () => {
    const { client } = startTestServer();

    const result = await client.execEnv("secret-value", "MY_SECRET", "/usr/bin/true", []);
    expect(result.exitCode).toBe(0);
  });
});
