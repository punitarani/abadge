import { describe, expect, test } from "bun:test";
import { SecretValue } from "./secret-value";

describe("SecretValue", () => {
  test("exposes plaintext only through the explicit expose method", () => {
    const secret = new SecretValue("super-secret");

    expect(secret.expose()).toBe("super-secret");
  });

  test("redacts string and JSON representations", () => {
    const secret = new SecretValue("super-secret");

    expect(String(secret)).toBe("[REDACTED]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
  });
});
