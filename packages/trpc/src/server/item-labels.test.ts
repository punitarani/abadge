import { describe, expect, test } from "bun:test";
import { fallbackItemLabel, resolveStoredLabel } from "./item-labels";

describe("item label helpers", () => {
  test("keeps operator-supplied labels for item writes", () => {
    expect(resolveStoredLabel("item-12345678", "Production API key")).toBe("Production API key");
  });

  test("falls back to deterministic migrated labels only when no cleartext label is available", () => {
    expect(resolveStoredLabel("item-12345678", "   ")).toBe(fallbackItemLabel("item-12345678"));
  });
});
