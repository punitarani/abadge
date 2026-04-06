import { describe, expect, test } from "bun:test";
import { serverEncrypt } from "@abadge/crypto/server";
import type { items } from "@abadge/db/schema";
import type { SessionRequestContext } from "../context";
import { runSessionEffect } from "../effect";
import { resolveItemDisplay } from "./items";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function createItemRow(overrides: Partial<typeof items.$inferSelect>): typeof items.$inferSelect {
  return {
    id: "item_123",
    userId: "user_123",
    vaultId: null,
    storageMode: "server_managed",
    encryptedItemKey: null,
    keyNonce: null,
    ciphertext: null,
    contentNonce: null,
    serverCiphertext: null,
    serverIv: null,
    serverKeyVersion: null,
    cryptoVersion: 1,
    contentVersion: 1,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function createSessionContext(
  rows: Array<typeof items.$inferSelect>,
  requestedItemIds: string[],
  userId = "user_123",
): SessionRequestContext {
  const selectedRows = rows.filter(
    (row) => row.userId === userId && row.deletedAt === null && requestedItemIds.includes(row.id),
  );

  return {
    req: new Request("http://localhost/trpc/items.resolveDisplay"),
    resHeaders: new Headers(),
    env: { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY } as SessionRequestContext["env"],
    validatedEnv: { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY } as SessionRequestContext["validatedEnv"],
    db: {
      select: () => ({
        from: () => ({
          where: async () => selectedRows,
        }),
      }),
    } as unknown as SessionRequestContext["db"],
    auth: {} as SessionRequestContext["auth"],
    identity: {
      kind: "session",
      userId,
    },
  };
}

describe("resolveItemDisplay", () => {
  test("returns the label for server-managed items", async () => {
    const payload = {
      v: 1,
      label: "Production API key",
      kind: "opaque" as const,
      tags: [],
      fields: { value: "secret" },
    };
    const encrypted = await serverEncrypt(
      new TextEncoder().encode(JSON.stringify(payload)),
      TEST_ENCRYPTION_KEY,
      1,
    );
    const input = { itemIds: ["item_sm_1"] };
    const ctx = createSessionContext(
      [
        createItemRow({
          id: "item_sm_1",
          storageMode: "server_managed",
          serverCiphertext: encrypted.ciphertext,
          serverIv: encrypted.iv,
          serverKeyVersion: encrypted.keyVersion,
        }),
      ],
      input.itemIds,
    );

    const result = await runSessionEffect(ctx, resolveItemDisplay(input));

    expect(result).toEqual({
      items: [
        {
          itemId: "item_sm_1",
          storageMode: "server_managed",
          label: "Production API key",
        },
      ],
    });
  });

  test("returns ciphertext fields for active zero-knowledge items without a label", async () => {
    const input = { itemIds: ["item_zk_1"] };
    const ctx = createSessionContext(
      [
        createItemRow({
          id: "item_zk_1",
          storageMode: "zero_knowledge",
          encryptedItemKey: "encrypted-item-key",
          ciphertext: "ciphertext",
        }),
      ],
      input.itemIds,
    );

    const result = await runSessionEffect(ctx, resolveItemDisplay(input));

    expect(result).toEqual({
      items: [
        {
          itemId: "item_zk_1",
          storageMode: "zero_knowledge",
          encryptedItemKey: "encrypted-item-key",
          ciphertext: "ciphertext",
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty("label");
  });

  test("omits soft-deleted items", async () => {
    const input = { itemIds: ["item_deleted"] };
    const ctx = createSessionContext(
      [
        createItemRow({
          id: "item_deleted",
          deletedAt: new Date("2026-04-02T00:00:00.000Z"),
          encryptedItemKey: "encrypted-item-key",
          ciphertext: "ciphertext",
          storageMode: "zero_knowledge",
        }),
      ],
      input.itemIds,
    );

    const result = await runSessionEffect(ctx, resolveItemDisplay(input));

    expect(result).toEqual({ items: [] });
  });

  test("omits items owned by another user", async () => {
    const input = { itemIds: ["item_foreign"] };
    const ctx = createSessionContext(
      [
        createItemRow({
          id: "item_foreign",
          userId: "user_other",
          encryptedItemKey: "encrypted-item-key",
          ciphertext: "ciphertext",
          storageMode: "zero_knowledge",
        }),
      ],
      input.itemIds,
    );

    const result = await runSessionEffect(ctx, resolveItemDisplay(input));

    expect(result).toEqual({ items: [] });
  });
});
