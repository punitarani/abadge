import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { isChunkLoadError, reloadForChunkError } from "./chunk-error";

const GUARD_KEY = "abadge:chunk-reload-at";

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

describe("reloadForChunkError", () => {
  // `now` strides far ahead of any prior call across tests so the module-level
  // in-memory guard from a previous test never falsely suppresses a new one.
  let now = 10_000_000;

  afterEach(() => {
    window.sessionStorage.clear();
    mock.restore();
  });

  test("reloads on the first chunk error and records the guard timestamp", () => {
    now += 1_000_000;
    spyOn(Date, "now").mockReturnValue(now);
    const reload = mock(() => {});

    expect(reloadForChunkError(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(Number(window.sessionStorage.getItem(GUARD_KEY))).toBe(now);
  });

  test("suppresses a second reload within the 10s guard window", () => {
    now += 1_000_000;
    spyOn(Date, "now").mockReturnValue(now);
    const reload = mock(() => {});

    expect(reloadForChunkError(reload)).toBe(true);
    // 5s later — still inside the guard window.
    (Date.now as ReturnType<typeof spyOn>).mockReturnValue(now + 5_000);
    expect(reloadForChunkError(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("allows another reload once the guard window has elapsed", () => {
    now += 1_000_000;
    spyOn(Date, "now").mockReturnValue(now);
    const reload = mock(() => {});

    expect(reloadForChunkError(reload)).toBe(true);
    // 11s later — past the 10s window, treated as a fresh stale-deploy.
    (Date.now as ReturnType<typeof spyOn>).mockReturnValue(now + 11_000);
    expect(reloadForChunkError(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("falls back to an in-memory guard when sessionStorage throws", () => {
    now += 1_000_000;
    spyOn(Date, "now").mockReturnValue(now);
    spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const reload = mock(() => {});

    // First call still recovers the user despite storage being unavailable.
    expect(reloadForChunkError(reload)).toBe(true);
    // 5s later the in-memory flag suppresses the loop instead of reloading again.
    (Date.now as ReturnType<typeof spyOn>).mockReturnValue(now + 5_000);
    expect(reloadForChunkError(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
