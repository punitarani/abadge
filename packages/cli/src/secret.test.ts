import { describe, expect, test } from "bun:test";
import { MultiFieldItemError } from "@abadge/core";
import type { AbadgeAgentClient } from "@abadge/sdk";
import { resolveSecretValue } from "./secret";

describe("resolveSecretValue", () => {
  test("falls back to mount access for server-managed items after a successful item lookup", async () => {
    const client = {
      getItem: async () => ({
        item: {
          id: "item_123",
          label: "Database password",
          storageMode: "server_managed" as const,
          cryptoVersion: 1,
          contentVersion: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      accessMount: async () => ({
        storageMode: "server_managed" as const,
        payload: {
          v: 1,
          label: "Database password",
          kind: "opaque" as const,
          tags: [],
          fields: {
            value: "super-secret",
          },
        },
      }),
    } as Pick<AbadgeAgentClient, "accessMount"> as AbadgeAgentClient;

    await expect(resolveSecretValue(client, "item_123", "env")).resolves.toBe("super-secret");
  });

  test("resolves an explicit named field from a multi-field payload", async () => {
    const client = {
      getItem: async () => ({
        item: {
          id: "item_123",
          label: "Database password",
          storageMode: "server_managed" as const,
          cryptoVersion: 1,
          contentVersion: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      accessMount: async () => ({
        storageMode: "server_managed" as const,
        payload: {
          fields: {
            username: "alice",
            password: "super-secret",
          },
        },
      }),
    } as Pick<AbadgeAgentClient, "accessMount"> as AbadgeAgentClient;

    await expect(resolveSecretValue(client, "item_123", "env", "password")).resolves.toBe(
      "super-secret",
    );
  });

  test("returns a clear error with hint when daemon is unavailable for ZK items", async () => {
    const client = {
      accessMount: async () => ({
        storageMode: "zero_knowledge" as const,
        encryptedItemKey: "encrypted-key",
        ciphertext: "encrypted-data",
      }),
    } as Pick<AbadgeAgentClient, "accessMount"> as AbadgeAgentClient;

    const result = resolveSecretValue(client, "item_zk", "env");

    await expect(result).rejects.toThrow(/daemon/i);
    await expect(resolveSecretValue(client, "item_zk", "env")).rejects.toThrow(/hint/i);
  });

  test("rejects ambiguous multi-field payloads when no field is provided", async () => {
    const client = {
      getItem: async () => ({
        item: {
          id: "item_123",
          label: "Database password",
          storageMode: "server_managed" as const,
          cryptoVersion: 1,
          contentVersion: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      accessMount: async () => ({
        storageMode: "server_managed" as const,
        payload: {
          fields: {
            username: "alice",
            password: "super-secret",
          },
        },
      }),
    } as Pick<AbadgeAgentClient, "accessMount"> as AbadgeAgentClient;

    await expect(resolveSecretValue(client, "item_123", "env")).rejects.toBeInstanceOf(
      MultiFieldItemError,
    );
  });
});
