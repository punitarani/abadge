import { MultiFieldItemError } from "@abadge/core";
import { describe, expect, test } from "bun:test";
import type { ApiClient } from "./client";
import { resolveSecretValue } from "./secret";

describe("resolveSecretValue", () => {
  test("falls back to mount access for server-managed items after a successful item lookup", async () => {
    const client = {
      getItem: async () => ({
        item: {
          id: "item_123",
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
    } as Pick<ApiClient, "getItem" | "accessMount"> as ApiClient;

    await expect(resolveSecretValue(client, "item_123", "env")).resolves.toBe("super-secret");
  });

  test("resolves an explicit named field from a multi-field payload", async () => {
    const client = {
      getItem: async () => ({
        item: {
          id: "item_123",
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
    } as Pick<ApiClient, "getItem" | "accessMount"> as ApiClient;

    await expect(resolveSecretValue(client, "item_123", "env", "password")).resolves.toBe(
      "super-secret",
    );
  });

  test("rejects ambiguous multi-field payloads when no field is provided", async () => {
    const client = {
      getItem: async () => ({
        item: {
          id: "item_123",
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
    } as Pick<ApiClient, "getItem" | "accessMount"> as ApiClient;

    await expect(resolveSecretValue(client, "item_123", "env")).rejects.toBeInstanceOf(
      MultiFieldItemError,
    );
  });
});
