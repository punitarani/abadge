import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
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

  test("util.inspect output is a SecretValue([REDACTED]) marker (not the plaintext)", () => {
    const secret = new SecretValue("super-secret");
    const out = inspect(secret);
    expect(out).toBe("SecretValue([REDACTED])");
    expect(out).not.toContain("super-secret");
  });

  test("template literal interpolation yields the redacted marker", () => {
    const secret = new SecretValue("super-secret");
    expect(`token=${secret}`).toBe("token=[REDACTED]");
  });
});
