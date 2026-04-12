import { describe, expect, test } from "bun:test";
import { SecretValue } from "./secret-value";

describe("SecretValue", () => {
  test("reveals plaintext only through the explicit reveal method", () => {
    const secret = new SecretValue("super-secret");

    expect(secret.reveal()).toBe("super-secret");
  });

  test("redacts string and JSON representations", () => {
    const secret = new SecretValue("super-secret");

    expect(String(secret)).toBe("[REDACTED_SECRET]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED_SECRET]"}');
  });
});
