import { describe, expect, test } from "bun:test";
import { normalizeRedirectPath } from "./redirect";

describe("normalizeRedirectPath", () => {
  test("uses the fallback for empty redirects", () => {
    expect(normalizeRedirectPath(null)).toBe("/items");
    expect(normalizeRedirectPath("")).toBe("/items");
  });

  test("keeps local app-relative redirects", () => {
    expect(normalizeRedirectPath("/items")).toBe("/items");
    expect(normalizeRedirectPath("/device/approve?user_code=ABCD1234")).toBe(
      "/device/approve?user_code=ABCD1234",
    );
  });

  test("rejects external and protocol-relative redirects", () => {
    expect(normalizeRedirectPath("https://evil.example")).toBe("/items");
    expect(normalizeRedirectPath("//evil.example")).toBe("/items");
    expect(normalizeRedirectPath("items")).toBe("/items");
  });
});
