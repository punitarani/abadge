/**
 * Unit coverage for the `list_items` MCP tool — uses spyOn rather than
 * mock.module so the mock is automatically scoped to this file (and
 * doesn't leak across the rest of the unit bucket).
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as apiClientModule from "../api-client";
import { handler, toolDescription, toolInputSchema, toolName } from "./list-items";

const apiClient = {
  listItems: mock(async () => ({ items: [{ id: "item_1", label: "x" }] })),
};

let getApiClientSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  getApiClientSpy = spyOn(apiClientModule, "getApiClient").mockResolvedValue(
    apiClient as unknown as Awaited<ReturnType<typeof apiClientModule.getApiClient>>,
  );
  apiClient.listItems = mock(async () => ({ items: [{ id: "item_1", label: "x" }] }));
});

afterEach(() => {
  getApiClientSpy.mockRestore();
});

describe("list_items tool", () => {
  test("toolName / description are stable", () => {
    expect(toolName).toBe("list_items");
    expect(toolDescription).toMatch(/list/i);
    // The schema accepts no input.
    expect(() => toolInputSchema.parse({})).not.toThrow();
  });

  test("happy path returns JSON-serialised items list", async () => {
    apiClient.listItems = mock(async () => ({
      items: [
        { id: "item_1", label: "alpha" },
        { id: "item_2", label: "beta" },
      ],
    })) as unknown as typeof apiClient.listItems;

    const out = await handler({}, {} as never);
    const parsed = JSON.parse(out) as { items: Array<{ id: string }> };
    expect(parsed.items.map((i) => i.id)).toEqual(["item_1", "item_2"]);
  });

  test("client error becomes an error envelope rather than a thrown exception", async () => {
    apiClient.listItems = mock(async () => {
      throw new Error("upstream down");
    }) as unknown as typeof apiClient.listItems;

    const out = await handler({}, {} as never);
    const parsed = JSON.parse(out) as { error?: string };
    expect(parsed.error).toBe("upstream down");
  });
});
