import { describe, expect, test } from "bun:test";
import { countDefaultProfiles } from "./page";

describe("countDefaultProfiles", () => {
  test("counts profiles whose name === 'internal'", () => {
    expect(
      countDefaultProfiles([
        { name: "internal" },
        { name: "customer-a" },
        { name: "customer-b" },
      ]),
    ).toBe(1);
  });

  test("returns 0 when no internal profile exists", () => {
    expect(countDefaultProfiles([{ name: "customer-a" }])).toBe(0);
  });

  test("returns 0 on empty input", () => {
    expect(countDefaultProfiles([])).toBe(0);
  });

  test("does NOT count server_managed profiles just because they are server-managed", () => {
    // Regression test for the original bug: previously this counted
    // p.storageMode === "server_managed" regardless of name.
    expect(
      countDefaultProfiles([
        { name: "customer-a" }, // would have been counted by the old buggy filter
      ]),
    ).toBe(0);
  });
});
