import { describe, expect, test } from "bun:test";
import { splitCombinedSetCookieHeader } from "./client";

describe("splitCombinedSetCookieHeader", () => {
  test("does not split on Expires commas", () => {
    const header = [
      "session=abc; Path=/; HttpOnly; Expires=Thu, 01 Jan 2026 00:00:00 GMT",
      "csrf=def; Path=/; Secure",
    ].join(", ");

    expect(splitCombinedSetCookieHeader(header)).toEqual([
      "session=abc; Path=/; HttpOnly; Expires=Thu, 01 Jan 2026 00:00:00 GMT",
      "csrf=def; Path=/; Secure",
    ]);
  });

  test("does not split on commas inside quoted cookie values", () => {
    const header = ['prefs="theme=light,mode=compact"; Path=/', "session=abc; Path=/"].join(", ");

    expect(splitCombinedSetCookieHeader(header)).toEqual([
      'prefs="theme=light,mode=compact"; Path=/',
      "session=abc; Path=/",
    ]);
  });
});
