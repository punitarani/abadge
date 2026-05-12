import { describe, expect, test } from "bun:test";
import { type AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";
import { errorMessage } from "../output";
import { runWithExpandEnv } from "./run";

describe("runWithExpandEnv", () => {
  test("propagates AbadgeApiError with hint intact when accessMount fails", async () => {
    const apiErr = new AbadgeApiError(
      403,
      "PERMISSION_DENIED",
      "Agent lacks mount_env capability for item_123",
      "Grant mount_env via: abadge permission grant --agent agt_1 --item item_123 --capability mount_env",
    );
    const client = {
      accessMount: async () => {
        throw apiErr;
      },
    } as unknown as AbadgeAgentClient;

    let caught: unknown;
    try {
      await runWithExpandEnv(client, "item_123", "echo", []);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AbadgeApiError);
    expect((caught as AbadgeApiError).code).toBe("PERMISSION_DENIED");
    expect((caught as AbadgeApiError).hint).toContain("Grant mount_env");

    // End-to-end: the CLI's error renderer shows the hint.
    const rendered = errorMessage(caught, "Failed to run command.");
    expect(rendered).toContain("Agent lacks mount_env capability");
    expect(rendered).toContain("Grant mount_env");
  });
});

describe("runWithAll", () => {
  test("propagates AbadgeApiError with hint intact when bulk fetch is denied", async () => {
    const apiErr = new AbadgeApiError(
      403,
      "PERMISSION_DENIED",
      "Remote agents cannot bulk-mount env vars",
      "Run the agent locally to use --all, or use access.reveal per-item remotely.",
    );
    const client = {
      bulkAccessMountEnv: async () => {
        throw apiErr;
      },
    } as unknown as AbadgeAgentClient;

    const { runWithAll } = await import("./run");
    let caught: unknown;
    try {
      await runWithAll(client, "prof_xyz", "echo", []);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AbadgeApiError);
    expect((caught as AbadgeApiError).code).toBe("PERMISSION_DENIED");
    const rendered = errorMessage(caught, "Failed to run command.");
    expect(rendered).toContain("Remote agents cannot");
    expect(rendered).toContain("Run the agent locally");
  });

  test("propagates PROFILE_NOT_FOUND with hint", async () => {
    const apiErr = new AbadgeApiError(
      404,
      "PROFILE_NOT_FOUND",
      "Profile not found",
      "Confirm the profileId belongs to the agent's organization.",
    );
    const client = {
      bulkAccessMountEnv: async () => {
        throw apiErr;
      },
    } as unknown as AbadgeAgentClient;

    const { runWithAll } = await import("./run");
    let caught: unknown;
    try {
      await runWithAll(client, "prof_missing", "echo", []);
    } catch (err) {
      caught = err;
    }

    expect((caught as AbadgeApiError).code).toBe("PROFILE_NOT_FOUND");
    const rendered = errorMessage(caught, "Failed to run command.");
    expect(rendered).toContain("Profile not found");
    expect(rendered).toContain("agent's organization");
  });
});

// ---------------------------------------------------------------------------
// Happy paths via the CLI daemon DI seam — verify the daemon RPC was
// invoked with the right shape and process.exit() got the daemon's exit code.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, spyOn } from "bun:test";
import type { DaemonClient } from "@abadge/daemon";
import { __resetDaemonClientFactoryForTests, __setDaemonClientFactoryForTests } from "../daemon";

class FakeRunDaemonClient {
  expandEnvCalls: unknown[] = [];
  expandEnvBulkCalls: unknown[] = [];
  expandEnv = async (...args: unknown[]): Promise<{ exitCode: number; durationMs: number }> => {
    this.expandEnvCalls.push(args);
    return { exitCode: 7, durationMs: 1 };
  };
  expandEnvBulk = async (...args: unknown[]): Promise<{ exitCode: number; durationMs: number }> => {
    this.expandEnvBulkCalls.push(args);
    return { exitCode: 5, durationMs: 1 };
  };
}

describe("runWithExpandEnv happy paths", () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let lastFake: FakeRunDaemonClient;

  beforeEach(() => {
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}`);
    }) as never);
    lastFake = new FakeRunDaemonClient();
    __setDaemonClientFactoryForTests(() => lastFake as unknown as DaemonClient);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    __resetDaemonClientFactoryForTests();
  });

  // run.ts's `try { ... process.exit(res.exitCode) }` re-wraps non-Abadge
  // errors as "--expand-env requires the local daemon". The mocked
  // process.exit throws a sentinel and is caught + wrapped, so the assertion
  // pattern is: verify the daemon was called with the right shape, then
  // verify the wrapped error's `cause` carries the exit-code sentinel.
  function exitCodeFromError(err: unknown): string | undefined {
    return (err as { cause?: { message?: string } } | null)?.cause?.message;
  }

  test("server-managed item: forwards payload (no AAD meta) and exits with daemon's code", async () => {
    const client = {
      accessMount: async () => ({
        storageMode: "server_managed" as const,
        payload: { fields: { value: "sk-x" } },
      }),
    } as unknown as AbadgeAgentClient;

    const { runWithExpandEnv } = await import("./run");
    let caught: unknown;
    try {
      await runWithExpandEnv(client, "item_x", "/usr/bin/true", []);
    } catch (err) {
      caught = err;
    }
    expect(exitCodeFromError(caught)).toContain("__exit_7");

    expect(lastFake.expandEnvCalls).toHaveLength(1);
    const args = lastFake.expandEnvCalls[0] as unknown[];
    // (encryptedItemKey, ciphertext, serverPayload, command, args, zkMeta)
    expect(args[0]).toBeNull();
    expect(args[1]).toBeNull();
    expect(args[2]).toEqual({ fields: { value: "sk-x" } });
    expect(args[3]).toBe("/usr/bin/true");
    expect(args[5]).toBeNull();
  });

  test("zero-knowledge item: forwards encrypted blob + AAD meta", async () => {
    const client = {
      accessMount: async () => ({
        storageMode: "zero_knowledge" as const,
        encryptedItemKey: "eik_blob",
        ciphertext: "ct_blob",
        profileId: "p_1",
        itemId: "item_x",
        contentVersion: 3,
      }),
    } as unknown as AbadgeAgentClient;

    const { runWithExpandEnv } = await import("./run");
    let caught: unknown;
    try {
      await runWithExpandEnv(client, "item_x", "/usr/bin/true", ["arg"]);
    } catch (err) {
      caught = err;
    }
    expect(exitCodeFromError(caught)).toContain("__exit_7");

    const args = lastFake.expandEnvCalls[0] as unknown[];
    expect(args[0]).toBe("eik_blob");
    expect(args[1]).toBe("ct_blob");
    expect(args[2]).toBeNull();
    expect(args[5]).toEqual({ profileId: "p_1", itemId: "item_x", contentVersion: 3 });
  });

  test("daemon failure surfaces a clear --expand-env message + chained cause", async () => {
    __setDaemonClientFactoryForTests(
      () =>
        ({
          expandEnv: async () => {
            throw new Error("daemon socket connect refused");
          },
        }) as unknown as DaemonClient,
    );
    const client = {
      accessMount: async () => ({
        storageMode: "server_managed" as const,
        payload: { fields: { value: "v" } },
      }),
    } as unknown as AbadgeAgentClient;

    const { runWithExpandEnv } = await import("./run");
    let caught: unknown;
    try {
      await runWithExpandEnv(client, "item_x", "/bin/echo", []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("--expand-env requires the local daemon");
    expect((caught as { cause?: Error }).cause?.message).toMatch(/daemon socket connect refused/);
  });
});

describe("runWithAll happy paths", () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let lastFake: FakeRunDaemonClient;

  beforeEach(() => {
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}`);
    }) as never);
    lastFake = new FakeRunDaemonClient();
    __setDaemonClientFactoryForTests(() => lastFake as unknown as DaemonClient);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    __resetDaemonClientFactoryForTests();
  });

  test("forwards bulk items + command + args to the daemon and exits with daemon's code", async () => {
    const client = {
      bulkAccessMountEnv: async () => ({
        items: [
          {
            itemId: "i1",
            label: "openai-api-key",
            storageMode: "server_managed" as const,
            payload: { fields: { value: "sk-1" } },
          },
          {
            itemId: "i2",
            label: "DATABASE_URL",
            storageMode: "server_managed" as const,
            payload: { fields: { value: "postgres://x" } },
          },
        ],
      }),
    } as unknown as AbadgeAgentClient;

    const { runWithAll } = await import("./run");
    let caught: unknown;
    try {
      await runWithAll(client, "p_1", "/usr/bin/true", []);
    } catch (err) {
      caught = err;
    }
    // Same pattern as runWithExpandEnv — the catch block re-wraps the
    // process.exit sentinel; verify the args (the actual contract under test)
    // and that the wrapped cause carries the daemon's exit code.
    expect(lastFake.expandEnvBulkCalls).toHaveLength(1);
    const args = lastFake.expandEnvBulkCalls[0] as unknown[];
    const items = args[0] as Array<{ itemId: string }>;
    expect(items.map((i) => i.itemId)).toEqual(["i1", "i2"]);
    expect(args[1]).toBe("/usr/bin/true");
    expect((caught as { cause?: { message?: string } }).cause?.message).toContain("__exit_5");
  });

  test("daemon failure surfaces a clear --all message + chained cause", async () => {
    __setDaemonClientFactoryForTests(
      () =>
        ({
          expandEnvBulk: async () => {
            throw new Error("ECONNREFUSED /run/abadge/vaultd.sock");
          },
        }) as unknown as DaemonClient,
    );

    const client = {
      bulkAccessMountEnv: async () => ({ items: [] }),
    } as unknown as AbadgeAgentClient;

    const { runWithAll } = await import("./run");
    let caught: unknown;
    try {
      await runWithAll(client, "p_1", "/usr/bin/true", []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("--all requires the local daemon");
    expect((caught as { cause?: Error }).cause?.message).toMatch(/ECONNREFUSED/);
  });
});

// ---------------------------------------------------------------------------
// §RM-PR4 — runWithUseRedeem / runWithUseRedeemBulk
// ---------------------------------------------------------------------------

function makeAgentClientWithAccess(impl: {
  use?: (
    target: { itemId: string } | { profileId: string },
    opts: { delivery: "env" | "file" },
  ) => Promise<unknown>;
  redeemMount?: (mountId: string) => Promise<unknown>;
}): AbadgeAgentClient {
  return {
    access: {
      use: impl.use ?? (async () => ({ mountId: "mnt_x", delivery: "env", expiresAt: "" })),
      redeemMount: impl.redeemMount ?? (async () => ({})),
    },
  } as unknown as AbadgeAgentClient;
}

describe("runWithUseRedeem (§RM-PR4)", () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let lastFake: FakeRunDaemonClient;

  beforeEach(() => {
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}`);
    }) as never);
    lastFake = new FakeRunDaemonClient();
    __setDaemonClientFactoryForTests(() => lastFake as unknown as DaemonClient);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    __resetDaemonClientFactoryForTests();
  });

  test("server-managed: use → redeemMount → daemon", async () => {
    const used: unknown[] = [];
    const redeemed: unknown[] = [];
    const client = makeAgentClientWithAccess({
      use: async (t, o) => {
        used.push({ t, o });
        return { mountId: "mnt_abc", delivery: "env", expiresAt: "" };
      },
      redeemMount: async (mountId) => {
        redeemed.push(mountId);
        return {
          storageMode: "server_managed",
          delivery: "env",
          payload: { fields: { value: "sk-x" } },
          label: "openai",
          itemId: "item_x",
        };
      },
    });
    const { runWithUseRedeem } = await import("./run");
    let caught: unknown;
    try {
      await runWithUseRedeem(client, "item_x", "/usr/bin/true", []);
    } catch (err) {
      caught = err;
    }
    expect(used).toHaveLength(1);
    expect(used[0]).toEqual({ t: { itemId: "item_x" }, o: { delivery: "env" } });
    expect(redeemed).toEqual(["mnt_abc"]);
    const args = lastFake.expandEnvCalls[0] as unknown[];
    expect(args[0]).toBeNull();
    expect(args[2]).toEqual({ fields: { value: "sk-x" } });
    expect((caught as { cause?: { message?: string } }).cause?.message).toContain("__exit_7");
  });

  test("zero-knowledge: forwards envelope + AAD meta to the daemon", async () => {
    const client = makeAgentClientWithAccess({
      redeemMount: async () => ({
        storageMode: "zero_knowledge",
        delivery: "env",
        encryptedItemKey: "eik",
        ciphertext: "ct",
        cryptoVersion: 1,
        contentVersion: 4,
        label: "DATABASE_URL",
        itemId: "item_y",
        profileId: "p_1",
      }),
    });
    const { runWithUseRedeem } = await import("./run");
    try {
      await runWithUseRedeem(client, "item_y", "/usr/bin/true", []);
    } catch {
      // expected: exit sentinel
    }
    const args = lastFake.expandEnvCalls[0] as unknown[];
    expect(args[0]).toBe("eik");
    expect(args[1]).toBe("ct");
    expect(args[5]).toEqual({ profileId: "p_1", itemId: "item_y", contentVersion: 4 });
  });

  test("MOUNT_NOT_FOUND propagates with hint", async () => {
    const apiErr = new AbadgeApiError(
      404,
      "MOUNT_NOT_FOUND",
      "Mount handle is not valid",
      "The handle may be expired or owned by a different agent.",
    );
    const client = makeAgentClientWithAccess({
      redeemMount: async () => {
        throw apiErr;
      },
    });
    const { runWithUseRedeem } = await import("./run");
    let caught: unknown;
    try {
      await runWithUseRedeem(client, "item_x", "/bin/true", []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AbadgeApiError);
    expect((caught as AbadgeApiError).code).toBe("MOUNT_NOT_FOUND");
  });

  // Regression for PR4 review C1: when the daemon is unavailable the hint
  // must point at the canonical `abadge profile unlock` command — the
  // `abadge vault unlock` command was deleted in this PR.
  test("daemon-unavailable hint points to 'abadge profile unlock'", async () => {
    // Replace the daemon factory with one whose expandEnv throws a non-Abadge
    // error — that is exactly the "daemon down / socket missing" path the
    // hint is intended for.
    __setDaemonClientFactoryForTests(
      () =>
        ({
          expandEnv: async () => {
            throw new Error("ECONNREFUSED");
          },
          expandEnvBulk: async () => {
            throw new Error("ECONNREFUSED");
          },
        }) as unknown as DaemonClient,
    );
    const client = makeAgentClientWithAccess({
      redeemMount: async () => ({
        storageMode: "server_managed",
        delivery: "env",
        payload: { fields: { value: "x" } },
        label: "openai",
        itemId: "item_x",
      }),
    });
    const { runWithUseRedeem } = await import("./run");
    let caught: unknown;
    try {
      await runWithUseRedeem(client, "item_x", "/bin/true", []);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toContain("abadge profile unlock");
    expect((caught as Error).message).not.toContain("abadge vault unlock");
  });
});

describe("runWithUseRedeemBulk (§RM-PR4)", () => {
  let exitSpy: ReturnType<typeof spyOn>;
  let lastFake: FakeRunDaemonClient;

  beforeEach(() => {
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit_${code ?? 0}`);
    }) as never);
    lastFake = new FakeRunDaemonClient();
    __setDaemonClientFactoryForTests(() => lastFake as unknown as DaemonClient);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    __resetDaemonClientFactoryForTests();
  });

  test("redeems each handle and forwards bulk items to the daemon", async () => {
    const redeemCalls: string[] = [];
    const client = makeAgentClientWithAccess({
      use: async () => ({
        items: [
          { itemId: "i1", mountId: "mnt_1", delivery: "env", expiresAt: "" },
          { itemId: "i2", mountId: "mnt_2", delivery: "env", expiresAt: "" },
        ],
      }),
      redeemMount: async (mountId) => {
        redeemCalls.push(mountId);
        if (mountId === "mnt_1") {
          return {
            storageMode: "server_managed",
            delivery: "env",
            payload: { fields: { value: "sk-1" } },
            label: "openai",
            itemId: "i1",
          };
        }
        return {
          storageMode: "zero_knowledge",
          delivery: "env",
          encryptedItemKey: "eik2",
          ciphertext: "ct2",
          cryptoVersion: 1,
          contentVersion: 2,
          label: "db",
          itemId: "i2",
          profileId: "p_1",
        };
      },
    });
    const { runWithUseRedeemBulk } = await import("./run");
    try {
      await runWithUseRedeemBulk(client, "p_1", "/usr/bin/true", []);
    } catch {
      // exit sentinel
    }
    expect(redeemCalls.sort()).toEqual(["mnt_1", "mnt_2"]);
    expect(lastFake.expandEnvBulkCalls).toHaveLength(1);
    const items = (lastFake.expandEnvBulkCalls[0] as unknown[])[0] as Array<{ itemId: string }>;
    expect(items.map((i) => i.itemId).sort()).toEqual(["i1", "i2"]);
  });

  test("empty profile spawns the command with parent env", async () => {
    const client = makeAgentClientWithAccess({
      use: async () => ({ items: [] }),
    });
    const { runWithUseRedeemBulk } = await import("./run");
    let caught: unknown;
    try {
      await runWithUseRedeemBulk(client, "p_empty", "/usr/bin/true", []);
    } catch (err) {
      caught = err;
    }
    expect(lastFake.expandEnvBulkCalls).toHaveLength(0);
    // exit code should be the real true (0), not the daemon's fake 5.
    expect((caught as Error).message).toContain("__exit_0");
  });

  // Regression for PR4 review C1: bulk variant must also point at the
  // canonical `abadge profile unlock` command in its daemon-unavailable hint.
  test("daemon-unavailable hint points to 'abadge profile unlock'", async () => {
    __setDaemonClientFactoryForTests(
      () =>
        ({
          expandEnv: async () => {
            throw new Error("ECONNREFUSED");
          },
          expandEnvBulk: async () => {
            throw new Error("ECONNREFUSED");
          },
        }) as unknown as DaemonClient,
    );
    const client = makeAgentClientWithAccess({
      use: async () => ({
        items: [{ itemId: "i1", mountId: "mnt_1", delivery: "env", expiresAt: "" }],
      }),
      redeemMount: async () => ({
        storageMode: "server_managed",
        delivery: "env",
        payload: { fields: { value: "x" } },
        label: "openai",
        itemId: "i1",
      }),
    });
    const { runWithUseRedeemBulk } = await import("./run");
    let caught: unknown;
    try {
      await runWithUseRedeemBulk(client, "p_1", "/bin/true", []);
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).message).toContain("abadge profile unlock");
    expect((caught as Error).message).not.toContain("abadge vault unlock");
  });
});
