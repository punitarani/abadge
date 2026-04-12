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
