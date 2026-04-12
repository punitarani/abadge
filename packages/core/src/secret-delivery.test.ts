import { describe, expect, test } from "bun:test";
import {
  BadRequestError,
  FieldNotFoundError,
  MultiFieldItemError,
  formatDomainError,
  resolveFieldValue,
} from "./index";

describe("resolveFieldValue", () => {
  test("uses the explicit field when requested", () => {
    expect(
      resolveFieldValue(
        {
          fields: {
            username: "alice",
            password: "super-secret",
          },
        },
        "password",
      ),
    ).toBe("super-secret");
  });

  test("uses fields.value for backwards-compatible single-value delivery", () => {
    expect(
      resolveFieldValue({
        fields: {
          value: "token-123",
        },
      }),
    ).toBe("token-123");
  });

  test("throws a multi-field error with an actionable hint when no default exists", () => {
    expect(() =>
      resolveFieldValue({
        fields: {
          username: "alice",
          password: "super-secret",
        },
      }),
    ).toThrow(MultiFieldItemError);

    try {
      resolveFieldValue({
        fields: {
          username: "alice",
          password: "super-secret",
        },
      });
    } catch (error) {
      const formatted = formatDomainError(error as MultiFieldItemError);
      expect(formatted.code).toBe("MULTI_FIELD_ITEM");
      expect(formatted.hint).toContain("username");
      expect(formatted.hint).toContain("password");
    }
  });

  test("throws a field-not-found error with the available field names", () => {
    expect(() =>
      resolveFieldValue(
        {
          fields: {
            cert: "cert-pem",
            key: "key-pem",
          },
        },
        "chain",
      ),
    ).toThrow(FieldNotFoundError);

    try {
      resolveFieldValue(
        {
          fields: {
            cert: "cert-pem",
            key: "key-pem",
          },
        },
        "chain",
      );
    } catch (error) {
      const formatted = formatDomainError(error as FieldNotFoundError);
      expect(formatted.code).toBe("FIELD_NOT_FOUND");
      expect(formatted.hint).toContain("cert");
      expect(formatted.hint).toContain("key");
    }
  });
});

describe("formatDomainError", () => {
  test("includes hint and meta for caller-facing rendering", () => {
    const formatted = formatDomainError(
      new BadRequestError({
        code: "BAD_REQUEST",
        message: "Invalid capability for this agent",
        hint: "Use mount_env, mount_file, or read_ciphertext for local agents.",
        meta: {
          capability: "reveal_plaintext",
          locality: "local",
        },
      }),
    );

    expect(formatted).toEqual({
      code: "BAD_REQUEST",
      message: "Invalid capability for this agent",
      hint: "Use mount_env, mount_file, or read_ciphertext for local agents.",
      meta: {
        capability: "reveal_plaintext",
        locality: "local",
      },
    });
  });
});
