import { describe, expect, test } from "bun:test";
import { itemsRouter } from "./items";

describe("items router public surface", () => {
  test("does not expose the legacy resolveDisplay procedure", () => {
    expect(itemsRouter._def.procedures).not.toHaveProperty("resolveDisplay");
  });
});
