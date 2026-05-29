import { describe, expect, test } from "bun:test";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@abadge/core";
import { TRPCError } from "@trpc/server";
import { Effect } from "effect";
import { getTrpcErrorData, mapStatusToTrpcCode, toTrpcError } from "./errors";
import { trpcErrorFormatter } from "./init";

/** Build a driver-style error carrying a `.code` (SQLSTATE or socket code). */
function dbErrorWithCode(code: string, message = "db failure"): Error {
  return Object.assign(new Error(message), { code });
}

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

  // §S1 §SEC4 — generic (non-domain) Errors must not leak DB messages to the wire
  test("sanitizes generic Error: returns 'Internal server error', not raw DB message", () => {
    const dbError = new Error(
      "ERROR: duplicate key value violates unique constraint 'profiles_organization_id_name_unique'",
    );
    const result = toTrpcError(dbError);

    expect(result.code).toBe("INTERNAL_SERVER_ERROR");
    expect(result.message).toBe("Internal server error");
    // cause is preserved for server-side logging/Sentry; it must not be absent
    expect(result.cause).toBe(dbError);
    // The raw DB message must not appear in the tRPC error message at all
    expect(result.message).not.toContain("profiles_organization_id_name_unique");
  });

  // §S1 §SEC4 — domain errors must still surface their real message unchanged
  test("domain errors preserve real message, code, hint, and meta", async () => {
    const failure = await Effect.runPromise(
      Effect.fail(
        new ForbiddenError({
          code: "MEMBER_INSUFFICIENT_ROLE",
          message: "Insufficient role",
          hint: "This action requires the 'admin' role or higher.",
          meta: { required: "admin", actual: "member" },
        }),
      ),
    ).catch((e) => e);

    const error = toTrpcError(failure);
    const data = getTrpcErrorData(error);

    expect(error.message).toBe("Insufficient role");
    expect(data.code).toBe("MEMBER_INSUFFICIENT_ROLE");
    expect(data.hint).toBe("This action requires the 'admin' role or higher.");
    expect(data.meta).toEqual({ required: "admin", actual: "member" });
  });
});

// §F — transient DB capacity/connectivity failures map to a retryable 503,
// not an opaque 500, so clients back off and the connection pool drains.
describe("toTrpcError — transient DB failures → 503", () => {
  test.each([
    ["53300", "too_many_connections"],
    ["53400", "configuration_limit_exceeded"],
    ["57014", "query_canceled (statement_timeout)"],
    ["57P03", "cannot_connect_now"],
    ["08006", "connection_failure (class 08)"],
    ["08000", "connection_exception (class 08)"],
    ["CONNECT_TIMEOUT", "driver connect timeout"],
    ["CONNECTION_CLOSED", "driver connection closed"],
    ["ECONNRESET", "socket reset"],
    ["ETIMEDOUT", "socket timeout"],
  ])("code %s (%s) → SERVICE_UNAVAILABLE", (code) => {
    const error = toTrpcError(dbErrorWithCode(code));

    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(getTrpcErrorData(error)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      hint: "The database is at capacity or briefly unreachable. Retry after a short backoff.",
      meta: { retryAfterSeconds: 2 },
    });
  });

  test("unwraps an effect-wrapped transient DB failure to 503", async () => {
    // tryAsync re-fails with the original Error, so the failure channel carries
    // the driver error (with .code) — mirror that with Effect.fail.
    const failure = await Effect.runPromise(Effect.fail(dbErrorWithCode("53300"))).catch((e) => e);

    const error = toTrpcError(failure);

    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(getTrpcErrorData(error).meta).toEqual({ retryAfterSeconds: 2 });
  });

  test("does NOT misclassify a real query bug (unique violation) as 503", () => {
    // 23505 = unique_violation — a genuine application error, must stay 500 and
    // must not leak the constraint name to the wire.
    const error = toTrpcError(
      dbErrorWithCode("23505", "duplicate key value violates unique constraint 'x_unique'"),
    );

    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("Internal server error");
    expect(error.message).not.toContain("x_unique");
  });

  test("a plain Error with no code stays 500", () => {
    const error = toTrpcError(new Error("boom"));
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});

describe("mapStatusToTrpcCode", () => {
  test.each([
    [400, "BAD_REQUEST"],
    [401, "UNAUTHORIZED"],
    [403, "FORBIDDEN"],
    [404, "NOT_FOUND"],
    [409, "CONFLICT"],
    [429, "TOO_MANY_REQUESTS"],
    [503, "SERVICE_UNAVAILABLE"],
    [500, "INTERNAL_SERVER_ERROR"],
    [418, "INTERNAL_SERVER_ERROR"],
  ])("status %i → %s", (status, expected) => {
    expect(mapStatusToTrpcCode(status) as string).toBe(expected);
  });
});

describe("trpcErrorFormatter (§S1 §SEC4)", () => {
  // Verifies the whitelist approach: only code + httpStatus survive from shape.data;
  // stack, path, and zodError (dev-only tRPC fields) are always stripped.
  test("strips stack, path, and zodError from shape.data unconditionally", () => {
    const fakeShape = {
      message: "Internal Server Error",
      code: -32603 as const,
      data: {
        code: "INTERNAL_SERVER_ERROR" as const,
        httpStatus: 500,
        stack: "Error\n    at Object.<anonymous> (/app/src/router.ts:42:11)\n    at ...",
        path: "items.create",
        zodError: null,
      },
    };
    const fakeTRPCError = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "x",
    });

    const result = trpcErrorFormatter({ shape: fakeShape, error: fakeTRPCError });

    expect(result.data).not.toHaveProperty("stack");
    expect(result.data).not.toHaveProperty("path");
    expect(result.data).not.toHaveProperty("zodError");
    // Whitelisted fields are present
    expect(result.data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(result.data.httpStatus).toBe(500);
    // top-level shape fields pass through unchanged
    expect(result.message).toBe("Internal Server Error");
    expect(result.code).toBe(-32603);
  });

  // Domain error extra fields (code, hint, meta) are merged in and survive
  test("merges domain error fields into data, still without stack/path/zodError", async () => {
    const failure = await Effect.runPromise(
      Effect.fail(
        new NotFoundError({
          code: "ITEM_NOT_FOUND",
          message: "Item not found",
          hint: "Verify the item id.",
        }),
      ),
    ).catch((e) => e);

    const trpcError = toTrpcError(failure);
    const fakeShape = {
      message: "Not Found",
      code: -32004 as const,
      data: {
        code: "NOT_FOUND" as const,
        httpStatus: 404,
        stack: "Error\n    at ...",
        path: "items.getById",
        zodError: null,
      },
    };

    const result = trpcErrorFormatter({ shape: fakeShape, error: trpcError });

    expect(result.data).not.toHaveProperty("stack");
    expect(result.data).not.toHaveProperty("path");
    expect(result.data).not.toHaveProperty("zodError");
    expect(result.data.code).toBe("ITEM_NOT_FOUND"); // domain code overrides shape code
    expect(result.data.httpStatus).toBe(404);
    expect(result.data.hint).toBe("Verify the item id.");
  });
});
