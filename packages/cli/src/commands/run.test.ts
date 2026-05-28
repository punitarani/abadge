import { describe, expect, test } from "bun:test";
import { type AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";

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

// ---------------------------------------------------------------------------
// runWithUseRedeem / runWithUseRedeemBulk
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
