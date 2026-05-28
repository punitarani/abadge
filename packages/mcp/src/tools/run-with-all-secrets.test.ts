import { describe, expect, spyOn, test } from "bun:test";
import * as apiClientModule from "../api-client.js";
import * as daemonClientModule from "../daemon-client.js";
import { handler } from "./run-with-all-secrets";

const fakeConfig = {
  apiUrl: "http://localhost",
  agentId: "agent_test",
  privateKey: "{}",
} as never;

type ItemData = {
  storageMode: "server_managed" | "zero_knowledge";
  itemId: string;
  label: string;
  payload?: { fields: Record<string, string> };
  encryptedItemKey?: string;
  ciphertext?: string;
  profileId?: string;
  contentVersion?: number;
};

function clientReturning(items: ItemData[]) {
  const mountMap = new Map<string, ItemData & { delivery: "env" }>();
  const mounts = items.map((item, i) => {
    const mountId = `mount-${i}`;
    mountMap.set(mountId, { ...item, delivery: "env" as const });
    return {
      itemId: item.itemId,
      mountId,
      delivery: "env" as const,
      expiresAt: "2099-01-01T00:00:00Z",
    };
  });

  return {
    access: {
      use: async () => ({ items: mounts }),
      redeemMount: async (mountId: string) => {
        const item = mountMap.get(mountId);
        if (!item) throw new Error(`Unknown mountId: ${mountId}`);
        return item;
      },
    },
  } as never;
}

describe("run_with_all_secrets handler", () => {
  test("response shape matches §RED1 contract — exit code, duration, line counts, truncation, injected count", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
      clientReturning([
        {
          storageMode: "server_managed",
          itemId: "item-1",
          label: "openai-api-key",
          payload: { fields: { value: "sk-aaa" } },
        },
      ]),
    );

    const result = await handler(
      {
        profileId: "prof-1",
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual([
      "durationMs",
      "exitCode",
      "injectedCount",
      "outputLineCount",
      "truncated",
    ]);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.injectedCount).toBe(1);

    clientSpy.mockRestore();
  });

  test("never forwards stdout content to the model — base64-encoded secret leakage stays opaque", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
      clientReturning([
        {
          storageMode: "server_managed",
          itemId: "item-1",
          label: "secret-key",
          payload: { fields: { value: "mysupersecret" } },
        },
      ]),
    );

    const result = await handler(
      {
        profileId: "prof-1",
        command: process.execPath,
        args: [
          "-e",
          `process.stdout.write(Buffer.from(process.env.SECRET_KEY ?? "").toString("base64"))`,
        ],
      },
      fakeConfig,
    );
    const base64Secret = Buffer.from("mysupersecret").toString("base64");
    expect(result).not.toContain("mysupersecret");
    expect(result).not.toContain(base64Secret);

    clientSpy.mockRestore();
  });

  test("normalizes label to env-var name — openai-api-key → OPENAI_API_KEY", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
      clientReturning([
        {
          storageMode: "server_managed",
          itemId: "item-1",
          label: "openai-api-key",
          payload: { fields: { value: "sk-aaa" } },
        },
      ]),
    );

    // Subprocess that exits 1 if OPENAI_API_KEY is missing, 0 if present.
    const result = await handler(
      {
        profileId: "prof-1",
        command: process.execPath,
        args: ["-e", "process.exit(process.env.OPENAI_API_KEY === 'sk-aaa' ? 0 : 1)"],
      },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    expect(parsed.exitCode).toBe(0);

    clientSpy.mockRestore();
  });

  test("silently skips multi-field items (login-shaped) — same rule as the daemon's exec.envBulk", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
      clientReturning([
        {
          storageMode: "server_managed",
          itemId: "item-1",
          label: "stripe-key",
          payload: { fields: { value: "sk-stripe" } },
        },
        {
          storageMode: "server_managed",
          itemId: "item-2",
          label: "main-db",
          payload: { fields: { username: "admin", password: "shh", url: "postgres://x" } },
        },
      ]),
    );

    const result = await handler(
      {
        profileId: "prof-1",
        command: process.execPath,
        args: [
          "-e",
          // Exit 0 only if STRIPE_KEY is present AND MAIN_DB / MAIN_DB_USERNAME are not set.
          "process.exit(process.env.STRIPE_KEY === 'sk-stripe' && !process.env.MAIN_DB && !process.env.MAIN_DB_USERNAME ? 0 : 1)",
        ],
      },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.injectedCount).toBe(1);

    clientSpy.mockRestore();
  });

  test("hard-rejects label that normalizes to a reserved env var", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
      clientReturning([
        {
          storageMode: "server_managed",
          itemId: "item-bad",
          label: "node-options",
          payload: { fields: { value: "--require /tmp/evil.js" } },
        },
      ]),
    );

    await expect(
      handler({ profileId: "prof-1", command: "/usr/bin/true", args: [] }, fakeConfig),
    ).rejects.toThrow(/id=item-bad.*reserved env var 'NODE_OPTIONS'/);

    clientSpy.mockRestore();
  });

  test("hard-rejects two items that collide on the same env-var name", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
      clientReturning([
        {
          storageMode: "server_managed",
          itemId: "item-A",
          label: "api-key",
          payload: { fields: { value: "first" } },
        },
        {
          storageMode: "server_managed",
          itemId: "item-B",
          label: "API_KEY",
          payload: { fields: { value: "second" } },
        },
      ]),
    );

    await expect(
      handler({ profileId: "prof-1", command: "/usr/bin/true", args: [] }, fakeConfig),
    ).rejects.toThrow(/collision on 'API_KEY'.*item-A.*item-B/);

    clientSpy.mockRestore();
  });

  test("rejects per-item secret larger than MAX_OUTPUT_BYTES (W3P4-001 bound)", async () => {
    const oversized = "A".repeat(9000);
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
      clientReturning([
        {
          storageMode: "server_managed",
          itemId: "item-1",
          label: "big-pem",
          payload: { fields: { value: oversized } },
        },
      ]),
    );

    await expect(
      handler({ profileId: "prof-1", command: "/usr/bin/true" }, fakeConfig),
    ).rejects.toThrow(/Secret for env var 'BIG_PEM' is 9000 bytes/);

    clientSpy.mockRestore();
  });

  test("decrypts ZK items via the daemon and merges with server-managed in one call", async () => {
    const clientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
      clientReturning([
        {
          storageMode: "zero_knowledge",
          itemId: "zk-1",
          label: "zk-key",
          encryptedItemKey: "wrap-key-blob",
          ciphertext: "cipher-blob",
          profileId: "prof-1",
          contentVersion: 1,
        },
        {
          storageMode: "server_managed",
          itemId: "sm-1",
          label: "sm-key",
          payload: { fields: { value: "v-sm" } },
        },
      ]),
    );
    const daemonSpy = spyOn(daemonClientModule, "daemonDecrypt").mockResolvedValue({
      payload: { fields: { value: "v-zk" } },
    });

    const result = await handler(
      {
        profileId: "prof-1",
        command: process.execPath,
        args: [
          "-e",
          "process.exit(process.env.ZK_KEY === 'v-zk' && process.env.SM_KEY === 'v-sm' ? 0 : 1)",
        ],
      },
      fakeConfig,
    );
    const parsed = JSON.parse(result);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.injectedCount).toBe(2);
    expect(daemonSpy).toHaveBeenCalledTimes(1);

    clientSpy.mockRestore();
    daemonSpy.mockRestore();
  });
});
