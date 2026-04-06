import { describe, expect, test } from "bun:test";
import { applySilentInputChunk } from "./prompt";

describe("applySilentInputChunk", () => {
  test("handles a full pasted password chunk ending in newline", () => {
    const result = applySilentInputChunk("VaultPass123!\n", "");

    expect(result).toEqual({
      input: "VaultPass123!",
      done: true,
      interrupt: false,
    });
  });

  test("stops on ctrl-c within a chunk", () => {
    const result = applySilentInputChunk("abc\u0003rest", "");

    expect(result).toEqual({
      input: "abc",
      done: false,
      interrupt: true,
    });
  });
});
