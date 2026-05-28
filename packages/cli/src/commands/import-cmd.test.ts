import { describe, expect, mock, test } from "bun:test";
import type { ItemSummary, UpdateItemInput } from "@abadge/core";
import type { AbadgeUserClient, CreateItemInput } from "@abadge/sdk";
import { importEntries } from "./import-cmd";

type ImportClient = Pick<AbadgeUserClient, "items">;

function itemSummary(overrides: Partial<ItemSummary>): ItemSummary {
  return {
    id: "item_1",
    label: "DATABASE_URL",
    storageMode: "server_managed",
    cryptoVersion: 1,
    contentVersion: 1,
    profileId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeClient(existing: ItemSummary[] = []): ImportClient {
  const listFn = mock(async () => ({ items: existing, nextCursor: null }));
  const createFn = mock(async (_data: CreateItemInput) => ({
    id: "item_new",
    label: "x",
    storageMode: "server_managed" as const,
    cryptoVersion: 1,
    contentVersion: 1,
    profileId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  }));
  const updateFn = mock(async (_id: string, _data: UpdateItemInput) => ({
    ok: true,
    contentVersion: 2,
  }));
  return {
    items: {
      list: listFn,
      create: createFn,
      update: updateFn,
    },
  } as unknown as ImportClient;
}

describe("importEntries", () => {
  test("creates new items when label does not exist", async () => {
    const client = makeClient([]);
    const summary = await importEntries(client, [{ key: "NEW_VAR", value: "hello" }], "opaque", {
      overwrite: false,
    });

    expect(summary).toEqual({ created: 1, updated: 0, skipped: 0, refused: 0, failed: 0 });
    expect(client.items.create).toHaveBeenCalledTimes(1);
    expect(client.items.update).toHaveBeenCalledTimes(0);
  });

  test("skips existing items when --overwrite is not set", async () => {
    const client = makeClient([itemSummary({ id: "item_1", label: "DATABASE_URL" })]);
    const summary = await importEntries(
      client,
      [{ key: "DATABASE_URL", value: "postgres://new" }],
      "opaque",
      { overwrite: false },
    );

    expect(summary).toEqual({ created: 0, updated: 0, skipped: 1, refused: 0, failed: 0 });
    expect(client.items.create).toHaveBeenCalledTimes(0);
    expect(client.items.update).toHaveBeenCalledTimes(0);
  });

  test("calls update when label exists and --overwrite is set", async () => {
    const client = makeClient([
      itemSummary({ id: "item_1", label: "DATABASE_URL", contentVersion: 3 }),
    ]);
    const summary = await importEntries(
      client,
      [{ key: "DATABASE_URL", value: "postgres://new" }],
      "opaque",
      { overwrite: true },
    );

    expect(summary).toEqual({ created: 0, updated: 1, skipped: 0, refused: 0, failed: 0 });
    expect(client.items.create).toHaveBeenCalledTimes(0);
    expect(client.items.update).toHaveBeenCalledTimes(1);

    // biome-ignore lint/suspicious/noExplicitAny: test-only mock introspection
    const call = (client.items.update as any).mock.calls[0];
    expect(call?.[0]).toBe("item_1");
    expect(call?.[1]).toMatchObject({
      storageMode: "server_managed",
      contentVersion: 3,
      payload: {
        v: 1,
        label: "DATABASE_URL",
        kind: "opaque",
        fields: { value: "postgres://new" },
      },
    });
  });

  test("refuses to overwrite zero_knowledge items (counted in refused, not skipped)", async () => {
    const client = makeClient([
      itemSummary({ id: "item_zk", label: "ZK_SECRET", storageMode: "zero_knowledge" }),
    ]);
    const summary = await importEntries(
      client,
      [{ key: "ZK_SECRET", value: "anything" }],
      "opaque",
      { overwrite: true },
    );

    expect(summary).toEqual({ created: 0, updated: 0, skipped: 0, refused: 1, failed: 0 });
    expect(client.items.create).toHaveBeenCalledTimes(0);
    expect(client.items.update).toHaveBeenCalledTimes(0);
  });

  test("dry-run does not call mutating methods", async () => {
    const client = makeClient([itemSummary({ id: "item_1", label: "EXISTING" })]);
    const summary = await importEntries(
      client,
      [
        { key: "EXISTING", value: "v1" },
        { key: "BRAND_NEW", value: "v2" },
      ],
      "opaque",
      { overwrite: true, dryRun: true },
    );

    expect(summary).toEqual({ created: 1, updated: 1, skipped: 0, refused: 0, failed: 0 });
    expect(client.items.create).toHaveBeenCalledTimes(0);
    expect(client.items.update).toHaveBeenCalledTimes(0);
  });

  test("mixed batch: creates new, updates existing", async () => {
    const client = makeClient([itemSummary({ id: "item_db", label: "DB_URL", contentVersion: 2 })]);
    const summary = await importEntries(
      client,
      [
        { key: "DB_URL", value: "postgres://new" },
        { key: "API_KEY", value: "sk_123" },
      ],
      "opaque",
      { overwrite: true },
    );

    expect(summary).toEqual({ created: 1, updated: 1, skipped: 0, refused: 0, failed: 0 });
    expect(client.items.create).toHaveBeenCalledTimes(1);
    expect(client.items.update).toHaveBeenCalledTimes(1);
  });

  test("API errors during create are counted in failed (drives non-zero exit)", async () => {
    const client = makeClient([]);
    client.items.create = mock(async (_data: CreateItemInput) => {
      throw new Error("network blew up");
    });
    const summary = await importEntries(client, [{ key: "WILL_FAIL", value: "v" }], "opaque", {
      overwrite: false,
    });

    expect(summary).toEqual({ created: 0, updated: 0, skipped: 0, refused: 0, failed: 1 });
    expect(client.items.create).toHaveBeenCalledTimes(1);
  });

  test("API errors during update are counted in failed", async () => {
    const client = makeClient([itemSummary({ id: "item_1", label: "DB_URL", contentVersion: 1 })]);
    client.items.update = mock(async (_id: string, _data: UpdateItemInput) => {
      throw new Error("conflict");
    });
    const summary = await importEntries(client, [{ key: "DB_URL", value: "v" }], "opaque", {
      overwrite: true,
    });

    expect(summary).toEqual({ created: 0, updated: 0, skipped: 0, refused: 0, failed: 1 });
    expect(client.items.update).toHaveBeenCalledTimes(1);
  });
});
