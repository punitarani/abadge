import { describe, expect, test } from "bun:test";
import { redactedJson, redactSecrets } from "./log";

describe("redactSecrets (AB-0091)", () => {
  test("masks secret-bearing keys at every depth, keeps the rest", () => {
    const out = redactSecrets({
      itemId: "item_1",
      value: "v",
      payload: { fields: { password: "p" } },
      nested: [{ token: "t", safe: "keep" }],
      safe: "keep",
    }) as Record<string, unknown>;

    expect(out.itemId).toBe("item_1");
    expect(out.safe).toBe("keep");
    expect(out.value).toBe("[redacted]");
    // `payload` is itself a secret key → the whole subtree is masked.
    expect(out.payload).toBe("[redacted]");
    const nested = out.nested as Array<Record<string, unknown>>;
    expect(nested[0]?.token).toBe("[redacted]");
    expect(nested[0]?.safe).toBe("keep");
  });

  test("passes non-objects through unchanged", () => {
    expect(redactSecrets("x")).toBe("x");
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(null)).toBe(null);
  });

  test("redactedJson stringifies with secrets masked", () => {
    expect(redactedJson({ password: "p", id: "1" })).toBe('{"password":"[redacted]","id":"1"}');
    // Contract: always a string, even when JSON.stringify would yield undefined.
    expect(redactedJson(undefined)).toBe("undefined");
  });
});
