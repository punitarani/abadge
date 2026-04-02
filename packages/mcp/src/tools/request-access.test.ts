import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { McpConfig } from "../config.js";

const mountMutate = mock(async () => ({ storageMode: "server_managed" }));
const daemonCallMock = mock(async () => undefined);

mock.module("../api-client.js", () => ({
  getApiClient: () => ({
    access: {
      mount: {
        mutate: mountMutate,
      },
    },
  }),
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

mock.module("../daemon-client.js", () => ({
  daemonCall: daemonCallMock,
}));

const { handler } = await import("./request-access");

const config: McpConfig = {
  apiUrl: "http://localhost:8787",
  authToken: "test-token",
};

describe("request_access", () => {
  beforeEach(() => {
    mountMutate.mockClear();
    daemonCallMock.mockClear();
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
    expect(mountMutate).toHaveBeenCalledWith({
      itemId: "item_123",
      mountType: "env",
    });
    expect(daemonCallMock).not.toHaveBeenCalled();
  });
});
