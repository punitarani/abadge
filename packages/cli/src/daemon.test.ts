/**
 * Unit coverage for cli/src/daemon.ts wrappers — each is a thin pass-through
 * to a freshly-constructed DaemonClient. We use the
 * `__setDaemonClientFactoryForTests` seam (cli/src/daemon.ts) instead of
 * `mock.module("@abadge/daemon")` so the test stays scoped to this file —
 * bun's module mocks are sticky across the whole process and would break
 * unrelated suites that import @abadge/daemon (mcp/resolve-secret etc).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { DaemonClient } from "@abadge/daemon";
import {
  __resetDaemonClientFactoryForTests,
  __setDaemonClientFactoryForTests,
  daemonAuthHeaders,
  daemonAuthStatus,
  daemonChangePassword,
  daemonClearAuthSession,
  daemonDecrypt,
  daemonEncrypt,
  daemonExecEnv,
  daemonExecMount,
  daemonExpandEnv,
  daemonExpandEnvBulk,
  daemonLock,
  daemonProcessRunning,
  daemonSetAuthOrg,
  daemonSetAuthSession,
  daemonStatus,
  daemonUnlock,
  daemonVaultStatus,
} from "./daemon";

const recorded: Array<{ method: string; args: unknown[] }> = [];
const constructorOpts: unknown[] = [];

class FakeDaemonClient {
  constructor(opts?: unknown) {
    constructorOpts.push(opts);
  }
  unlock = (...a: unknown[]) => record("unlock", a, { ok: true, keyVersion: 1 });
  lock = (...a: unknown[]) => record("lock", a, { ok: true });
  status = (...a: unknown[]) => record("status", a, { unlocked: false });
  setAuthSession = (...a: unknown[]) => record("setAuthSession", a, { ok: true });
  setAuthOrg = (...a: unknown[]) => record("setAuthOrg", a, { ok: true });
  clearAuthSession = (...a: unknown[]) => record("clearAuthSession", a, { ok: true });
  authStatus = (...a: unknown[]) => record("authStatus", a, { authed: false });
  authHeaders = (...a: unknown[]) => record("authHeaders", a, { headers: {} });
  changePassword = (...a: unknown[]) => record("changePassword", a, { ok: true });
  encrypt = (...a: unknown[]) =>
    record("encrypt", a, { ciphertext: "c", encryptedItemKey: "k", contentNonce: "n" });
  decrypt = (...a: unknown[]) => record("decrypt", a, { payload: { v: 1 } });
  execEnv = (...a: unknown[]) => record("execEnv", a, { exitCode: 0, durationMs: 1 });
  expandEnv = (...a: unknown[]) => record("expandEnv", a, { exitCode: 0, durationMs: 1 });
  expandEnvBulk = (...a: unknown[]) => record("expandEnvBulk", a, { exitCode: 0, durationMs: 1 });
  execMount = (...a: unknown[]) => record("execMount", a, { mountId: "m", path: "/tmp" });
}

function record<T>(method: string, args: unknown[], ret: T): Promise<T> {
  recorded.push({ method, args });
  return Promise.resolve(ret);
}

beforeAll(() => {
  __setDaemonClientFactoryForTests(() => new FakeDaemonClient() as unknown as DaemonClient);
});

afterAll(() => {
  __resetDaemonClientFactoryForTests();
});

afterEach(() => {
  recorded.length = 0;
  constructorOpts.length = 0;
});

describe("daemon wrappers — each invokes the right RPC with right args", () => {
  test("daemonUnlock(profileId, masterPassword) -> client.unlock(...)", async () => {
    await daemonUnlock("prof_1", "pw");
    expect(recorded).toEqual([{ method: "unlock", args: ["prof_1", "pw"] }]);
  });

  test("daemonLock -> client.lock", async () => {
    await daemonLock();
    expect(recorded[0]?.method).toBe("lock");
  });

  test("daemonStatus + alias daemonVaultStatus", async () => {
    await daemonStatus();
    await daemonVaultStatus();
    expect(recorded.map((r) => r.method)).toEqual(["status", "status"]);
  });

  test("daemonSetAuthSession / daemonSetAuthOrg / daemonClearAuthSession / daemonAuthStatus / daemonAuthHeaders", async () => {
    const session = { sessionToken: "tok", organizationId: "org_1" } as unknown as Parameters<
      typeof daemonSetAuthSession
    >[0];
    await daemonSetAuthSession(session);
    await daemonSetAuthOrg("org_1");
    await daemonSetAuthOrg(null);
    await daemonClearAuthSession();
    await daemonAuthStatus();
    await daemonAuthHeaders();
    expect(recorded.map((r) => r.method)).toEqual([
      "setAuthSession",
      "setAuthOrg",
      "setAuthOrg",
      "clearAuthSession",
      "authStatus",
      "authHeaders",
    ]);
    expect(recorded[1]?.args).toEqual(["org_1"]);
    expect(recorded[2]?.args).toEqual([null]);
  });

  test("daemonChangePassword forwards profileId + old + new", async () => {
    await daemonChangePassword("prof_1", "old", "new");
    expect(recorded[0]).toEqual({
      method: "changePassword",
      args: ["prof_1", "old", "new"],
    });
  });

  test("daemonEncrypt / daemonDecrypt forward payload/meta", async () => {
    await daemonEncrypt({ v: 1 }, { profileId: "p", itemId: "i", contentVersion: 1 });
    await daemonDecrypt("eik", "ct", { profileId: "p", itemId: "i", contentVersion: 1 });
    expect(recorded[0]?.method).toBe("encrypt");
    expect(recorded[0]?.args).toEqual([
      { v: 1 },
      { profileId: "p", itemId: "i", contentVersion: 1 },
    ]);
    expect(recorded[1]?.method).toBe("decrypt");
    expect(recorded[1]?.args).toEqual([
      "eik",
      "ct",
      { profileId: "p", itemId: "i", contentVersion: 1 },
    ]);
  });

  test("daemonExecEnv forwards (secret, envVar, command, args)", async () => {
    await daemonExecEnv("s3cret", "ABADGE_SECRET", "echo", ["hi"]);
    expect(recorded[0]).toEqual({
      method: "execEnv",
      args: ["s3cret", "ABADGE_SECRET", "echo", ["hi"]],
    });
  });

  test("daemonExpandEnv forwards (eik, ct, serverPayload, command, args, zkMeta)", async () => {
    await daemonExpandEnv("eik", "ct", null, "node", ["-e", "1"], {
      profileId: "p",
      itemId: "i",
      contentVersion: 1,
    });
    expect(recorded[0]).toEqual({
      method: "expandEnv",
      args: [
        "eik",
        "ct",
        null,
        "node",
        ["-e", "1"],
        { profileId: "p", itemId: "i", contentVersion: 1 },
      ],
    });
  });

  test("daemonExpandEnvBulk forwards items + command + args", async () => {
    const items = [{ itemId: "i1", label: "L", storageMode: "server_managed" }];
    await daemonExpandEnvBulk(
      items as unknown as Parameters<typeof daemonExpandEnvBulk>[0],
      "echo",
      [],
    );
    expect(recorded[0]?.method).toBe("expandEnvBulk");
    expect(recorded[0]?.args).toEqual([items, "echo", []]);
  });

  test("daemonExecMount forwards secret/path/mode (mode optional)", async () => {
    await daemonExecMount("v", "/tmp/x", 0o600);
    expect(recorded[0]?.args).toEqual(["v", "/tmp/x", 0o600]);
  });
});

describe("daemon process state passthroughs", () => {
  test("daemonProcessRunning is callable", () => {
    // Real daemon isn't actually running in tests — just exercise the call.
    expect(() => daemonProcessRunning()).not.toThrow();
  });
});
