import { describe, expect, test } from "bun:test";
import { Either, ParseResult, Schema } from "effect";
import {
  FieldNotFoundError,
  formatDomainError,
  parseErrorToValidationError,
  ValidationError,
} from "./errors";

describe("formatDomainError", () => {
  test("preserves validation issues for transport envelopes", () => {
    const formatted = formatDomainError(
      new ValidationError({
        code: "VALIDATION_ERROR",
        message: "kind is required",
        hint: "Check the invalid input fields and try again.",
        issues: [
          {
            path: ["kind"],
            message: "kind is required",
          },
        ],
      }),
    );

    expect(formatted).toEqual({
      code: "VALIDATION_ERROR",
      message: "kind is required",
      hint: "Check the invalid input fields and try again.",
      meta: undefined,
      issues: [
        {
          path: ["kind"],
          message: "kind is required",
        },
      ],
    });
  });

  test("keeps typed delivery metadata on field lookup failures", () => {
    const formatted = formatDomainError(new FieldNotFoundError("password", ["username", "token"]));

    expect(formatted).toEqual({
      code: "FIELD_NOT_FOUND",
      message: 'Field "password" was not found on this item.',
      hint: "Available fields: username, token.",
      meta: {
        field: "password",
        availableFields: ["username", "token"],
      },
    });
  });
});

describe("parseErrorToValidationError", () => {
  test("converts Effect parse errors into the shared validation envelope", () => {
    const parseResult = Schema.decodeUnknownEither(
      Schema.Struct({
        itemId: Schema.String.pipe(Schema.minLength(1)),
      }),
    )({});

    if (Either.isLeft(parseResult) && ParseResult.isParseError(parseResult.left)) {
      const formatted = formatDomainError(parseErrorToValidationError(parseResult.left));
      expect(formatted.code).toBe("VALIDATION_ERROR");
      expect(formatted.issues?.[0]?.path).toEqual(["itemId"]);
      return;
    }

    throw new Error("expected parse failure");
  });
});
