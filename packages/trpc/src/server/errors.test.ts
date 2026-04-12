import { describe, expect, test } from "bun:test";
import { BadRequestError, NotFoundError, UnauthorizedError, ValidationError } from "@abadge/core";
import { Effect } from "effect";
import { getTrpcErrorData, toTrpcError } from "./errors";

describe("toTrpcError", () => {
  test("unwraps effect failures into domain-specific trpc codes", async () => {
    const failure = await Effect.runPromise(
      Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
          hint: "Verify the item id and try again.",
        }),
      ),
    ).catch((error) => error);

    const error = toTrpcError(failure);

    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Item not found");
    expect(getTrpcErrorData(error)).toEqual({
      code: "ITEM_NOT_FOUND",
      hint: "Verify the item id and try again.",
    });
  });

  test("preserves validation issues from effect failures", async () => {
    const failure = await Effect.runPromise(
      Effect.fail(
        new ValidationError({
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          hint: "Fix the highlighted input fields and try again.",
          issues: [{ path: ["name"], message: "Required" }],
        }),
      ),
    ).catch((error) => error);

    const error = toTrpcError(failure);

    expect(error.code).toBe("BAD_REQUEST");
    expect(getTrpcErrorData(error)).toEqual({
      code: "VALIDATION_ERROR",
      hint: "Fix the highlighted input fields and try again.",
      issues: [{ path: ["name"], message: "Required" }],
    });
  });

  test("still maps plain domain errors without effect wrappers", () => {
    const error = toTrpcError(
      new UnauthorizedError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
        hint: "Sign in again and retry the request.",
      }),
    );

    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.message).toBe("Unauthorized");
  });

  test("preserves hint and meta for caller-facing transport formatting", () => {
    const error = toTrpcError(
      new BadRequestError({
        code: "INVALID_CAPABILITY_LOCALITY",
        message: "Remote agents cannot mount env vars",
        hint: "Use reveal_plaintext or register a local agent.",
        meta: {
          capability: "mount_env",
          locality: "remote",
        },
      }),
    );

    expect(getTrpcErrorData(error)).toEqual({
      code: "INVALID_CAPABILITY_LOCALITY",
      hint: "Use reveal_plaintext or register a local agent.",
      meta: {
        capability: "mount_env",
        locality: "remote",
      },
    });
  });
});
