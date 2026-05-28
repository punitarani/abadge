import { describe, expect, test } from "bun:test";
import { drainAll } from "./drain-all";

describe("drainAll", () => {
  test("concatenates every page and stops at nextCursor=null", async () => {
    // 120 rows in pages of 50 — larger than one server page, so a consumer that
    // filters client-side (the dashboard) must receive all of them, not just 50.
    const ROWS = Array.from({ length: 120 }, (_, i) => ({ id: `item-${i}` }));
    const PAGE = 50;
    let calls = 0;
    const result = await drainAll<{ id: string }>(async (cursor) => {
      calls++;
      const start = cursor ? Number(cursor) : 0;
      const next = start + PAGE;
      return {
        rows: ROWS.slice(start, next),
        nextCursor: next < ROWS.length ? String(next) : null,
      };
    });

    expect(calls).toBe(3); // 50 + 50 + 20
    expect(result).toHaveLength(120);
    // An item on page 3 (well beyond the first server page) is present — the
    // exact case where the pre-drain dashboard wrongly showed "No items match".
    expect(result.some((r) => r.id === "item-119")).toBe(true);
    expect(result.map((r) => r.id)).toEqual(ROWS.map((r) => r.id));
  });

  test("returns a single page unchanged when nextCursor is null", async () => {
    let calls = 0;
    const result = await drainAll<number>(async () => {
      calls++;
      return { rows: [1, 2, 3], nextCursor: null };
    });
    expect(calls).toBe(1);
    expect(result).toEqual([1, 2, 3]);
  });

  test("throws if pagination never terminates (runaway guard)", async () => {
    // A cursor that never resolves to null must hit the page cap and throw
    // rather than loop forever in the browser.
    await expect(
      drainAll<number>(async () => ({ rows: [1], nextCursor: "always" })),
    ).rejects.toThrow(/did not terminate/);
  });
});
