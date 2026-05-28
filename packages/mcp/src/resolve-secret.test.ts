import { describe, expect, test } from "bun:test";
import { MultiFieldItemError } from "@abadge/core";
import { resolveSecret } from "./resolve-secret";

describe("resolveSecret", () => {
  test("resolves a named field from server-managed payloads", async () => {
    const client = {
      access: {
        use: async () => ({
          mountId: "mount-1",
          delivery: "file" as const,
          expiresAt: "2099-01-01T00:00:00Z",
        }),
        redeemMount: async () => ({
          storageMode: "server_managed" as const,
          delivery: "file" as const,
          label: "cert",
          itemId: "item_cert",
          payload: {
            fields: {
              cert: "cert-pem",
              key: "key-pem",
            },
          },
        }),
      },
    };

    await expect(resolveSecret(client as never, "item_cert", "file", "key")).resolves.toBe(
      "key-pem",
    );
  });

  test("rejects multi-field payloads without an explicit field", async () => {
    const client = {
      access: {
        use: async () => ({
          mountId: "mount-1",
          delivery: "file" as const,
          expiresAt: "2099-01-01T00:00:00Z",
        }),
        redeemMount: async () => ({
          storageMode: "server_managed" as const,
          delivery: "file" as const,
          label: "cert",
          itemId: "item_cert",
          payload: {
            fields: {
              cert: "cert-pem",
              key: "key-pem",
            },
          },
        }),
      },
    };

    await expect(resolveSecret(client as never, "item_cert", "file")).rejects.toBeInstanceOf(
      MultiFieldItemError,
    );
  });

  test("returns a clear error when daemon is unavailable for ZK items", async () => {
    const client = {
      access: {
        use: async () => ({
          mountId: "mount-1",
          delivery: "env" as const,
          expiresAt: "2099-01-01T00:00:00Z",
        }),
        redeemMount: async () => ({
          storageMode: "zero_knowledge" as const,
          delivery: "env" as const,
          label: "zk-key",
          itemId: "item_zk",
          encryptedItemKey: "encrypted-key",
          ciphertext: "encrypted-data",
          cryptoVersion: 1,
          contentVersion: 1,
          profileId: "prof-1",
        }),
      },
    };

    await expect(resolveSecret(client as never, "item_zk", "env")).rejects.toThrow(/daemon/i);
  });
});
