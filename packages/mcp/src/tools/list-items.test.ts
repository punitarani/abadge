import { afterAll, describe, expect, mock, test } from "bun:test";

const apiClient = {
  listItems: mock(async () => ({ items: [{ id: "item_1", label: "x" }] })),
};

const realApiClient = await import("../api-client");

mock.module("../api-client", () => ({
  ...realApiClient,
  getApiClient: async () => apiClient,
}));

afterAll(() => {
  // Re-install the real api-client so later tests see the unmocked module.
  mock.module("../api-client", () => ({ ...realApiClient }));
});

const { handler, toolName, toolDescription, toolInputSchema } = await import("./list-items");

describe("list_items tool", () => {
  test("toolName / description are stable", () => {
    expect(toolName).toBe("list_items");
    expect(toolDescription).toMatch(/list/i);
    // The schema accepts no input.
    expect(() => toolInputSchema.parse({})).not.toThrow();
  });

  test("happy path returns JSON-serialised items list", async () => {
    apiClient.listItems.mockResolvedValueOnce({
      items: [
        { id: "item_1", label: "alpha" },
        { id: "item_2", label: "beta" },
      ],
    } as Awaited<ReturnType<typeof apiClient.listItems>>);

    const out = await handler({}, {} as never);
    const parsed = JSON.parse(out) as { items: Array<{ id: string }> };
    expect(parsed.items.map((i) => i.id)).toEqual(["item_1", "item_2"]);
  });

  test("client error becomes an error envelope rather than a thrown exception", async () => {
    apiClient.listItems.mockRejectedValueOnce(new Error("upstream down"));

    const out = await handler({}, {} as never);
    const parsed = JSON.parse(out) as { error?: string };
    expect(parsed.error).toBe("upstream down");
  });
});
