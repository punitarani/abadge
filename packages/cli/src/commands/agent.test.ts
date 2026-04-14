import { describe, expect, test } from "bun:test";
import { configSlotForKind } from "./agent";

describe("configSlotForKind", () => {
  test("local_cli maps to the cli slot", () => {
    expect(configSlotForKind("local_cli")).toBe("cli");
  });

  test("local_mcp maps to the mcp slot", () => {
    expect(configSlotForKind("local_mcp")).toBe("mcp");
  });

  test("remote maps to null so no local slot is written", () => {
    // Remote agents don't run on the user's machine; registering one must
    // not overwrite ~/.abadge/config.json's localAgents.cli or .mcp entries.
    expect(configSlotForKind("remote")).toBeNull();
  });
});
