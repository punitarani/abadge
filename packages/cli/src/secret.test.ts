import { describe, expect, test } from "bun:test";
import { MultiFieldItemError } from "@abadge/core";
import type { AbadgeAgentClient } from "@abadge/sdk";
import { resolveSecretValue } from "./secret";

/**
 * `resolveSecretValue` resolves a secret through the canonical
 * `access.use` + `access.redeemMount` path so plain `abadge run --item`,
 * `abadge mount`, and the `--expand-env` / `--all` paths all flow through
 * the same mint→redeem→audit lifecycle.
 *
 * Tests here exercise the surface contract — given an item id, the function
 * returns the decrypted secret string (or throws on
 * multi-field/daemon-unavailable cases) — by mocking `access.use` and
 * `access.redeemMount`. There is no `accessMount` method, so regressing to it
 * is a compile error rather than something a runtime spy must guard.
 */
function buildSmAccessClient(fields: Record<string, string>): AbadgeAgentClient {
  return {
    access: {
      use: async () => ({ mountId: "mnt_x", delivery: "env", expiresAt: "" }),
      redeemMount: async () => ({
        storageMode: "server_managed" as const,
        delivery: "env" as const,
        payload: { fields },
        label: "Test",
        itemId: "item_123",
      }),
    },
  } as unknown as AbadgeAgentClient;
}

describe("resolveSecretValue — redeemMount path", () => {
  test("resolves the single-field value for server-managed items", async () => {
    const client = buildSmAccessClient({ value: "super-secret" });
    await expect(resolveSecretValue(client, "item_123", "env")).resolves.toBe("super-secret");
  });

  test("resolves an explicit named field from a multi-field payload", async () => {
    const client = buildSmAccessClient({ username: "alice", password: "super-secret" });
    await expect(resolveSecretValue(client, "item_123", "env", "password")).resolves.toBe(
      "super-secret",
    );
  });

  test("returns a clear error with hint when daemon is unavailable for ZK items", async () => {
    const client = {
      access: {
        use: async () => ({ mountId: "mnt_zk", delivery: "env", expiresAt: "" }),
        redeemMount: async () => ({
          storageMode: "zero_knowledge" as const,
          delivery: "env" as const,
          encryptedItemKey: "encrypted-key",
          ciphertext: "encrypted-data",
          cryptoVersion: 1,
          contentVersion: 1,
          label: "zk-item",
          itemId: "item_zk",
          profileId: "prof_1",
        }),
      },
    } as unknown as AbadgeAgentClient;

    await expect(resolveSecretValue(client, "item_zk", "env")).rejects.toThrow(/daemon/i);
    await expect(resolveSecretValue(client, "item_zk", "env")).rejects.toThrow(/hint/i);
  });

  test("rejects ambiguous multi-field payloads when no field is provided", async () => {
    const client = buildSmAccessClient({ username: "alice", password: "super-secret" });
    await expect(resolveSecretValue(client, "item_123", "env")).rejects.toBeInstanceOf(
      MultiFieldItemError,
    );
  });

  // Pin the canonical mint→redeem lifecycle: resolveSecretValue calls
  // access.use then access.redeemMount exactly once each. There is no
  // accessMount method, so regressing to it is a compile error rather than
  // something a runtime spy must guard.
  test("mints and redeems exactly once (audit uniformity)", async () => {
    let useCalls = 0;
    let redeemCalls = 0;
    const client = {
      access: {
        use: async () => {
          useCalls++;
          return { mountId: "mnt_x", delivery: "env" as const, expiresAt: "" };
        },
        redeemMount: async () => {
          redeemCalls++;
          return {
            storageMode: "server_managed" as const,
            delivery: "env" as const,
            payload: { fields: { value: "ok" } },
            label: "x",
            itemId: "item_x",
          };
        },
      },
    } as unknown as AbadgeAgentClient;

    await expect(resolveSecretValue(client, "item_x", "env")).resolves.toBe("ok");
    expect(useCalls).toBe(1);
    expect(redeemCalls).toBe(1);
  });
});
