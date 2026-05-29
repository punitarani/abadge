import { describe, expect, test } from "bun:test";
import { isChunkLoadError } from "./chunk-error";

describe("isChunkLoadError", () => {
  test("matches webpack ChunkLoadError by name", () => {
    const error = Object.assign(new Error("nope"), { name: "ChunkLoadError" });
    expect(isChunkLoadError(error)).toBe(true);
  });

  test("matches the 'Loading chunk N failed' message", () => {
    expect(
      isChunkLoadError(
        new Error(
          "Loading chunk 1627 failed.\n(error: https://abadge.io/_next/static/chunks/1627-d5ca38969cf61712.js)",
        ),
      ),
    ).toBe(true);
  });

  test("matches CSS chunk failures", () => {
    expect(isChunkLoadError(new Error("Loading CSS chunk 42 failed."))).toBe(true);
  });

  test("matches native dynamic-import failures across browsers", () => {
    expect(
      isChunkLoadError(new Error("Failed to fetch dynamically imported module: https://x/a.js")),
    ).toBe(true);
    expect(
      isChunkLoadError(new Error("error loading dynamically imported module: https://x/a.js")),
    ).toBe(true);
    expect(isChunkLoadError(new Error("Importing a module script failed."))).toBe(true);
  });

  test("accepts a bare string message", () => {
    expect(isChunkLoadError("Loading chunk 9 failed.")).toBe(true);
  });

  test("ignores unrelated errors and empty values", () => {
    expect(isChunkLoadError(new Error("TypeError: x is not a function"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError("")).toBe(false);
  });
});
