import { describe, expect, test } from "bun:test";
import { MultiFieldItemError } from "@abadge/core";
import type { AbadgeAgentClient } from "@abadge/sdk";
import { resolveSecretValue } from "./secret";

/**
 * §RM-PR4 — `resolveSecretValue` resolves a secret through the canonical
 * `access.use` + `access.redeemMount` path so plain `abadge run --item`,
 * `abadge mount`, and the `--expand-env` / `--all` paths all flow through
 * the same mint→redeem→audit lifecycle (review C3).
 *
 * Tests here exercise the same surface contract as before — given an item id,
 * the function returns the decrypted secret string (or throws on
 * multi-field/daemon-unavailable cases) — but they pin the new code path by
 * mocking `access.use` and `access.redeemMount`. A regression to the legacy
 * `accessMount` path would fail the "MUST NOT call accessMount" assertion.
 */
function buildSmAccessClient(
  fields: Record<string, string>,
): AbadgeAgentClient & { accessMount: () => Promise<never> } {
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
    accessMount: async () => {
      throw new Error(
        "accessMount must NOT be called from resolveSecretValue (review C3 regression)",
      );
    },
  } as unknown as AbadgeAgentClient & { accessMount: () => Promise<never> };
}

describe("resolveSecretValue (§RM-PR4 — redeemMount path)", () => {
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

  // PR4 review C3 — pin that the legacy mount path is no longer reachable
  // from the canonical resolver. If a future refactor regresses to
  // `client.accessMount(...)`, the spy throws and the test fails.
  test("never invokes the legacy accessMount path (audit uniformity)", async () => {
    let useCalls = 0;
    let redeemCalls = 0;
    let accessMountCalls = 0;
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
      accessMount: async () => {
        accessMountCalls++;
        throw new Error("accessMount must not be reached");
      },
    } as unknown as AbadgeAgentClient;

    await expect(resolveSecretValue(client, "item_x", "env")).resolves.toBe("ok");
    expect(useCalls).toBe(1);
    expect(redeemCalls).toBe(1);
    expect(accessMountCalls).toBe(0);
  });
});
