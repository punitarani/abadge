import { describe, expect, test } from "bun:test";
import {
  BadRequestError,
  expandFieldSelection,
  FieldNotFoundError,
  formatDomainError,
  labelToEnvKey,
  listStringFields,
  MultiFieldItemError,
  resolveFieldValue,
  resolveFieldValues,
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

describe("field expansion helpers", () => {
  test("lists only string fields from a payload", () => {
    expect(
      listStringFields({
        fields: {
          username: "alice",
          retries: 3,
          enabled: true,
          password: "super-secret",
        },
      }),
    ).toEqual(["username", "password"]);
  });

  test("prefers standard fields for the item kind when no field was explicitly requested", () => {
    expect(
      expandFieldSelection({
        kind: "login",
        fields: {
          password: "super-secret",
          username: "alice",
          notes: "ignored",
        },
      }),
    ).toEqual(["username", "password"]);
  });

  test("resolves multiple requested fields into a delivery-safe map", () => {
    expect(
      resolveFieldValues(
        {
          kind: "certificate",
          fields: {
            cert: "cert-pem",
            key: "key-pem",
            chain: "chain-pem",
          },
        },
        ["key", "cert", "key"],
      ),
    ).toEqual({
      key: "key-pem",
      cert: "cert-pem",
    });
  });
});

describe("labelToEnvKey", () => {
  test("uppercases and preserves valid identifiers verbatim", () => {
    expect(labelToEnvKey("DATABASE_URL")).toBe("DATABASE_URL");
    expect(labelToEnvKey("API_KEY")).toBe("API_KEY");
  });

  test("uppercases lowercase labels", () => {
    expect(labelToEnvKey("database_url")).toBe("DATABASE_URL");
  });

  test("substitutes hyphens, dots, and spaces with underscores", () => {
    expect(labelToEnvKey("openai-api-key")).toBe("OPENAI_API_KEY");
    expect(labelToEnvKey("pg.primary.host")).toBe("PG_PRIMARY_HOST");
    expect(labelToEnvKey("stripe live key")).toBe("STRIPE_LIVE_KEY");
  });

  test("collapses runs of underscores from punctuation clusters", () => {
    expect(labelToEnvKey("DB---URL")).toBe("DB_URL");
    expect(labelToEnvKey("foo___bar")).toBe("FOO_BAR");
  });

  test("trims trailing underscores from punctuation suffixes", () => {
    expect(labelToEnvKey("api-key-")).toBe("API_KEY");
    expect(labelToEnvKey("token...")).toBe("TOKEN");
  });

  test("prepends underscore when label starts with a digit", () => {
    expect(labelToEnvKey("1password")).toBe("_1PASSWORD");
    expect(labelToEnvKey("42-secret")).toBe("_42_SECRET");
  });

  test("returns empty string for unsalvageable labels", () => {
    expect(labelToEnvKey("")).toBe("");
    expect(labelToEnvKey("***")).toBe("");
    expect(labelToEnvKey("___")).toBe("");
  });

  test("does not enforce RESERVED_ENV_KEYS — that is the caller's job", () => {
    // labelToEnvKey is purely a normalizer. Reservation rejection lives in
    // the caller so it can attribute the failure to a specific item id/label.
    expect(labelToEnvKey("path")).toBe("PATH");
    expect(labelToEnvKey("ld-preload")).toBe("LD_PRELOAD");
    expect(labelToEnvKey("node-options")).toBe("NODE_OPTIONS");
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
