import { describe, expect, test } from "bun:test";
import { countProfilesByStorage } from "./count-profiles-by-storage";

describe("countProfilesByStorage", () => {
  test("returns zeros for an empty list", () => {
    expect(countProfilesByStorage([])).toEqual({ serverManaged: 0, zeroKnowledge: 0 });
  });

  test("counts each storage mode independently", () => {
    expect(
      countProfilesByStorage([
        { storageMode: "server_managed" },
        { storageMode: "zero_knowledge" },
        { storageMode: "server_managed" },
      ]),
    ).toEqual({ serverManaged: 2, zeroKnowledge: 1 });
  });

  test("ignores unknown storage modes (defensive — schema is the source of truth)", () => {
    expect(
      countProfilesByStorage([
        { storageMode: "server_managed" },
        // biome-ignore lint/suspicious/noExplicitAny: defensive coverage of unexpected values
        { storageMode: "future_mode" } as any,
      ]),
    ).toEqual({ serverManaged: 1, zeroKnowledge: 0 });
  });
});
