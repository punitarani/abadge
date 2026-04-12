import { describe, expect, test } from "bun:test";
import { MultiFieldItemError } from "@abadge/core";
import { resolveSecret } from "./resolve-secret";

describe("resolveSecret", () => {
  test("resolves a named field from server-managed payloads", async () => {
    const client = {
      accessMount: async () => ({
        storageMode: "server_managed" as const,
        payload: {
          fields: {
            cert: "cert-pem",
            key: "key-pem",
          },
        },
      }),
    };

    await expect(resolveSecret(client as never, "item_cert", "file", "key")).resolves.toBe(
      "key-pem",
    );
  });

  test("rejects multi-field payloads without an explicit field", async () => {
    const client = {
      accessMount: async () => ({
        storageMode: "server_managed" as const,
        payload: {
          fields: {
            cert: "cert-pem",
            key: "key-pem",
          },
        },
      }),
    };

    await expect(resolveSecret(client as never, "item_cert", "file")).rejects.toBeInstanceOf(
      MultiFieldItemError,
    );
  });
});
