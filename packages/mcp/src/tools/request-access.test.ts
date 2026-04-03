import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { McpConfig } from "../config.js";

type AccessMountResult = {
  storageMode: "server_managed" | "zero_knowledge";
  payload: {
    v: number;
    label: string;
    kind: "opaque";
    tags: string[];
    fields: Record<string, unknown>;
  };
  encryptedItemKey?: string;
  ciphertext?: string;
};

const accessMountMock = mock(
  async (): Promise<AccessMountResult> => ({
    storageMode: "server_managed",
    payload: { v: 1, label: "", kind: "opaque", tags: [], fields: {} },
  }),
);
const daemonDecryptMock = mock(async () => ({ payload: "decrypted" }));

mock.module("../api-client.js", () => ({
  getApiClient: () => ({
    accessMount: accessMountMock,
  }),
}));

mock.module("../daemon-client.js", () => ({
  daemonDecrypt: daemonDecryptMock,
}));

const { handler } = await import("./request-access");

const config: McpConfig = {
  apiUrl: "http://localhost:8787",
  authToken: "test-token",
};

describe("request_access", () => {
  beforeEach(() => {
    accessMountMock.mockClear();
    daemonDecryptMock.mockClear();
  });

  test("returns granted for server_managed access", async () => {
    const result = JSON.parse(
      await handler(
        {
          itemId: "item_123",
          capability: "mount_env",
        },
        config,
      ),
    ) as { status: string; itemId: string; capability: string };

    expect(result).toEqual({
      status: "granted",
      itemId: "item_123",
      capability: "mount_env",
    });
    expect(accessMountMock).toHaveBeenCalledWith("item_123", "env");
    expect(daemonDecryptMock).not.toHaveBeenCalled();
  });

  test("returns granted for zero_knowledge access after daemon decrypt", async () => {
    accessMountMock.mockResolvedValueOnce({
      storageMode: "zero_knowledge" as const,
      encryptedItemKey: "enc-key-123",
      ciphertext: "ct-456",
      payload: { v: 1, label: "", kind: "opaque" as const, tags: [], fields: {} },
    });

    const result = JSON.parse(
      await handler(
        {
          itemId: "item_zk",
          capability: "mount_file",
        },
        config,
      ),
    ) as { status: string; itemId: string; capability: string };

    expect(result).toEqual({
      status: "granted",
      itemId: "item_zk",
      capability: "mount_file",
    });
    expect(accessMountMock).toHaveBeenCalledWith("item_zk", "file");
    expect(daemonDecryptMock).toHaveBeenCalledWith("enc-key-123", "ct-456");
  });

  test("returns error when daemon decrypt fails for zero_knowledge", async () => {
    accessMountMock.mockResolvedValueOnce({
      storageMode: "zero_knowledge" as const,
      encryptedItemKey: "enc-key-123",
      ciphertext: "ct-456",
      payload: { v: 1, label: "", kind: "opaque" as const, tags: [], fields: {} },
    });
    daemonDecryptMock.mockRejectedValueOnce(new Error("Daemon not running"));

    const result = JSON.parse(
      await handler(
        {
          itemId: "item_zk",
          capability: "mount_env",
        },
        config,
      ),
    ) as { status: string; error: string };

    expect(result).toEqual({
      status: "error",
      error: "Daemon not running",
    });
  });

  test("returns denied when API rejects access", async () => {
    accessMountMock.mockRejectedValueOnce(new Error("Forbidden"));

    const result = JSON.parse(
      await handler(
        {
          itemId: "item_denied",
          capability: "mount_env",
        },
        config,
      ),
    ) as { status: string; error: string };

    expect(result).toEqual({
      status: "denied",
      error: "Access denied",
    });
  });
});
