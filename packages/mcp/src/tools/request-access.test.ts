import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { McpConfig } from "../config.js";

const accessMountMock = mock(async () => ({
  storageMode: "server_managed" as const,
  payload: { v: 1, label: "", kind: "opaque" as const, tags: [], fields: {} },
}));
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

  test("returns granted for successful access requests", async () => {
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
});
