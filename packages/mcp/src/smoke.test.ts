import { describe, expect, test } from "bun:test";
import { toolName as listItemsTool } from "./tools/list-items.js";

/**
 * Minimal tests so `bun test` succeeds in CI (Bun exits 1 when no test files match).
 * Add focused tests alongside features as the MCP surface grows.
 */
describe("@abadge/mcp", () => {
  test("list_items tool has stable name", () => {
    expect(listItemsTool).toBe("list_items");
  });
});
