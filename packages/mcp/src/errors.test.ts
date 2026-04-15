import { describe, expect, test } from "bun:test";
import { AbadgeApiError } from "@abadge/sdk";
import { toErrorPayload } from "./errors";

describe("toErrorPayload", () => {
  test("preserves hint, code, and meta from AbadgeApiError", () => {
    const err = new AbadgeApiError(404, "FIELD_NOT_FOUND", "field not found", "Available: a, b", {
      available: ["a", "b"],
    });

    const payload = toErrorPayload(err);

    expect(payload).toEqual({
      error: "field not found",
      code: "FIELD_NOT_FOUND",
      hint: "Available: a, b",
      meta: { available: ["a", "b"] },
    });
  });

  test("omits hint and meta when absent on AbadgeApiError", () => {
    const err = new AbadgeApiError(500, "INTERNAL", "boom");

    const payload = toErrorPayload(err);

    expect(payload).toEqual({ error: "boom", code: "INTERNAL" });
  });

  test("falls back to error.message for plain Error instances", () => {
    expect(toErrorPayload(new Error("daemon unavailable"))).toEqual({
      error: "daemon unavailable",
    });
  });

  test("uses fallback for non-Error throws", () => {
    expect(toErrorPayload("oops", "Failed to do X")).toEqual({ error: "Failed to do X" });
    expect(toErrorPayload(undefined)).toEqual({ error: "Unknown error" });
  });
});
