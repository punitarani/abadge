import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
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

function allocDaemonDir(): { dir: string; socketPath: string; pidPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "abadge-daemon-client-"));
  tempDirs.push(dir);
  chmodSync(dir, 0o700);
  return {
    dir,
    socketPath: join(dir, "vaultd.sock"),
    pidPath: join(dir, "vaultd.pid"),
  };
}

async function startServerInDir(dir: {
  socketPath: string;
  pidPath: string;
}): Promise<DaemonServer> {
  const server = await startServer(
    resolveConfig({
      socketPath: dir.socketPath,
      pidPath: dir.pidPath,
      apiUrl: "http://localhost:8787",
    }),
  );
  servers.push(server);
  return server;
}

// -----------------------------------------------------------------------------
// W3P12-001 / Critical C-2 — DaemonClient TOFU handshake regression tests.
// -----------------------------------------------------------------------------
//
// These drive DaemonClient with a mock in-memory pinned-fingerprint store so
// we can assert:
//   1. First contact pins the fingerprint + fires onFirstContact callback.
//   2. A subsequent call with a matching pin proceeds silently.
//   3. A client pointed at a different daemon (mismatched fingerprint) throws.
//   4. Non-sensitive RPCs don't trigger the handshake (otherwise identity.sign
//      would infinitely recurse).

describe("DaemonClient TOFU handshake (W3P12-001)", () => {
  test("first contact with an empty pin pins the fingerprint and invokes onFirstContact", async () => {
    const daemonDir = allocDaemonDir();
    await startServerInDir(daemonDir);

    let pinned: string | null = null;
    const firstContactFired: string[] = [];
    const client = new DaemonClient({
      socketPath: daemonDir.socketPath,
      getPinnedFingerprint: async () => pinned,
      onFirstContact: async (fp) => {
        pinned = fp;
        firstContactFired.push(fp);
      },
    });

    // Any sensitive call triggers the handshake. auth.setSession is the
    // easiest — just sets a short-lived session token in daemon memory.
    const status = await client.setAuthSession({
      type: "better_auth_session",
      token: "session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(status.authenticated).toBe(true);

    // onFirstContact fired exactly once, with a 32-char hex fingerprint.
    expect(firstContactFired).toHaveLength(1);
    const observed = firstContactFired[0];
    expect(observed).toMatch(/^[0-9a-f]{32}$/);
    expect(pinned as unknown as string).toBe(observed as string);
  });

  test("subsequent sensitive call with matching pin proceeds silently (no extra pin)", async () => {
    const daemonDir = allocDaemonDir();
    await startServerInDir(daemonDir);

    let pinned: string | null = null;
    const firstContactFired: string[] = [];

    // First client pins.
    const firstClient = new DaemonClient({
      socketPath: daemonDir.socketPath,
      getPinnedFingerprint: async () => pinned,
      onFirstContact: async (fp) => {
        pinned = fp;
        firstContactFired.push(fp);
      },
    });
    await firstClient.setAuthSession({
      type: "better_auth_session",
      token: "t1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(firstContactFired).toHaveLength(1);

    // Second client (fresh instance — has no cached verification) with the
    // SAME pinned fingerprint. onFirstContact MUST NOT fire again.
    const secondClient = new DaemonClient({
      socketPath: daemonDir.socketPath,
      getPinnedFingerprint: async () => pinned,
      onFirstContact: async (fp) => {
        firstContactFired.push(fp);
      },
    });
    await secondClient.setAuthSession({
      type: "better_auth_session",
      token: "t2",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(firstContactFired).toHaveLength(1);
  });

  test("mismatched pin throws DAEMON_IDENTITY_CHANGED before writing the sensitive frame", async () => {
    const daemonDir = allocDaemonDir();
    await startServerInDir(daemonDir);

    const client = new DaemonClient({
      socketPath: daemonDir.socketPath,
      getPinnedFingerprint: async () => "00".repeat(16), // 32 hex chars that no real key will match
      onFirstContact: async () => {
        throw new Error("onFirstContact should not fire when a pin already exists");
      },
    });

    await expect(
      client.setAuthSession({
        type: "better_auth_session",
        token: "should-not-be-sent",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toThrow(/DAEMON_IDENTITY_CHANGED/);

    // After a mismatch, a follow-up attempt also fails (state is NOT poisoned
    // in a way that accidentally succeeds later — every sensitive call must
    // re-check until ensureVerified caches a good fingerprint).
    await expect(
      client.setAuthSession({
        type: "better_auth_session",
        token: "still-should-not-be-sent",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toThrow(/DAEMON_IDENTITY_CHANGED/);
  });

  test("two different daemons have different fingerprints — pin from daemon A does NOT validate daemon B", async () => {
    const dirA = allocDaemonDir();
    const serverA = await startServerInDir(dirA);

    // Pin with daemon A.
    let pinned: string | null = null;
    const pinClient = new DaemonClient({
      socketPath: dirA.socketPath,
      getPinnedFingerprint: async () => pinned,
      onFirstContact: async (fp) => {
        pinned = fp;
      },
    });
    await pinClient.setAuthSession({
      type: "better_auth_session",
      token: "t",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(pinned).not.toBeNull();

    // Close A, start daemon B in a fresh dir (new keypair).
    serverA.close();

    const dirB = allocDaemonDir();
    await startServerInDir(dirB);

    // Point a new client at B but with A's pinned fingerprint.
    const cross = new DaemonClient({
      socketPath: dirB.socketPath,
      getPinnedFingerprint: async () => pinned,
      onFirstContact: async () => {
        throw new Error("onFirstContact should not fire when a pin already exists");
      },
    });

    await expect(
      cross.setAuthSession({
        type: "better_auth_session",
        token: "should-not-be-sent",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toThrow(/DAEMON_IDENTITY_CHANGED/);
  });

  test("non-sensitive vault.status does NOT trigger the handshake (avoids recursion)", async () => {
    const daemonDir = allocDaemonDir();
    await startServerInDir(daemonDir);

    let getPinnedCalls = 0;
    const client = new DaemonClient({
      socketPath: daemonDir.socketPath,
      getPinnedFingerprint: async () => {
        getPinnedCalls += 1;
        return null;
      },
      onFirstContact: async () => {
        throw new Error("onFirstContact should not fire for vault.status");
      },
    });

    const status = await client.status();
    expect(typeof status.locked).toBe("boolean");
    // Handshake pins never ran, so getPinnedFingerprint was never called.
    expect(getPinnedCalls).toBe(0);
  });

  test("custom onMismatch error factory is surfaced to the caller", async () => {
    const daemonDir = allocDaemonDir();
    await startServerInDir(daemonDir);

    const client = new DaemonClient({
      socketPath: daemonDir.socketPath,
      getPinnedFingerprint: async () => "ff".repeat(16),
      onMismatch: (expected, actual) => new Error(`CUSTOM:${expected}:${actual}`),
    });

    await expect(
      client.setAuthSession({
        type: "better_auth_session",
        token: "t",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).rejects.toThrow(/^CUSTOM:/);
  });
});
