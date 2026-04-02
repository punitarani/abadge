import { describe, expect, test } from "bun:test";
import { NotFoundError, UnauthorizedError, ValidationError } from "@abadge/core";
import { Effect } from "effect";
import { getTrpcErrorData, toTrpcError } from "./errors";

describe("toTrpcError", () => {
  test("unwraps effect failures into domain-specific trpc codes", async () => {
    const failure = await Effect.runPromise(
      Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
        }),
      ),
    ).catch((error) => error);

    const error = toTrpcError(failure);

    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Item not found");
    expect(getTrpcErrorData(error)).toEqual({
      appCode: "ITEM_NOT_FOUND",
      issues: undefined,
    });
  });

  test("preserves validation issues from effect failures", async () => {
    const failure = await Effect.runPromise(
      Effect.fail(
        new ValidationError({
          code: "VALIDATION_ERROR",
          message: "Invalid input",
          issues: [{ path: ["name"], message: "Required" }],
        }),
      ),
    ).catch((error) => error);

    const error = toTrpcError(failure);

    expect(error.code).toBe("BAD_REQUEST");
    expect(getTrpcErrorData(error)).toEqual({
      appCode: "VALIDATION_ERROR",
      issues: [{ path: ["name"], message: "Required" }],
    });
  });

  test("still maps plain domain errors without effect wrappers", () => {
    const error = toTrpcError(
      new UnauthorizedError({
        code: "UNAUTHORIZED",
        message: "Unauthorized",
      }),
    );

    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.message).toBe("Unauthorized");
  });
});
