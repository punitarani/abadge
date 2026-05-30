import { describe, expect, test } from "bun:test";
import { AbadgeApiError } from "./errors";

describe("AbadgeApiError", () => {
  test("preserves hint and meta from normalized tRPC errors", () => {
    const error = AbadgeApiError.fromUnknown(
      {
        message: "Remote agents cannot mount env vars",
        data: {
          httpStatus: 400,
          code: "INVALID_CAPABILITY_LOCALITY",
          hint: "Use reveal_plaintext or register a local agent.",
          meta: {
            capability: "mount_env",
            locality: "remote",
          },
        },
      },
      "Fallback message",
    );

    expect(error.statusCode).toBe(400);
    expect(error.code).toBe("INVALID_CAPABILITY_LOCALITY");
    expect(error.message).toBe("Remote agents cannot mount env vars");
    expect(error.hint).toBe("Use reveal_plaintext or register a local agent.");
    expect(error.meta).toEqual({
      capability: "mount_env",
      locality: "remote",
    });
  });

  test("fromResponse preserves valid issues", async () => {
    const res = new Response(
      JSON.stringify({
        error: "bad input",
        code: "VALIDATION_ERROR",
        hint: "check the fields",
        issues: [
          { path: ["body", "email"], message: "must be valid email" },
          { path: ["body", "age"], message: "must be positive" },
        ],
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
    const err = await AbadgeApiError.fromResponse(res, "fallback");
    expect(err.issues).toBeDefined();
    expect(err.issues).toHaveLength(2);
    expect(err.issues?.[0]).toEqual({ path: ["body", "email"], message: "must be valid email" });
    expect(err.issues?.[1]).toEqual({ path: ["body", "age"], message: "must be positive" });
  });

  test("fromResponse preserves path with numeric segments", async () => {
    const res = new Response(
      JSON.stringify({
        error: "bad input",
        code: "VALIDATION_ERROR",
        issues: [{ path: ["body", "items", 0, "name"], message: "required" }],
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
    const err = await AbadgeApiError.fromResponse(res, "fallback");
    expect(err.issues).toBeDefined();
    expect(err.issues?.[0]?.path).toEqual(["body", "items", 0, "name"]);
    expect(err.issues?.[0]?.message).toBe("required");
  });

  test("fromResponse returns empty array for empty issues array (distinguishable from missing)", async () => {
    const res = new Response(JSON.stringify({ error: "x", code: "VALIDATION_ERROR", issues: [] }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const err = await AbadgeApiError.fromResponse(res, "fallback");
    expect(err.issues).toBeDefined();
    expect(err.issues).toHaveLength(0);
  });

  test("fromResponse drops malformed issues array", async () => {
    const res = new Response(
      JSON.stringify({
        error: "x",
        code: "VALIDATION_ERROR",
        issues: [{ path: "not-array", message: 123 }],
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
    const err = await AbadgeApiError.fromResponse(res, "fallback");
    expect(err.issues).toBeUndefined();
  });

  test("fromResponse handles missing issues", async () => {
    const res = new Response(JSON.stringify({ error: "x", code: "UNAUTHORIZED" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
    const err = await AbadgeApiError.fromResponse(res, "fallback");
    expect(err.issues).toBeUndefined();
  });

  test("fromUnknown preserves valid issues via tRPC error shape", () => {
    const trpcLike = {
      message: "validation failed",
      data: {
        httpStatus: 400,
        code: "VALIDATION_ERROR",
        hint: "fix the fields",
        issues: [{ path: ["input", "name"], message: "required" }],
      },
    };
    const err = AbadgeApiError.fromUnknown(trpcLike, "fallback");
    expect(err.issues).toBeDefined();
    expect(err.issues?.[0]?.path).toEqual(["input", "name"]);
    expect(err.issues?.[0]?.message).toBe("required");
  });

  test("fromUnknown drops non-array issues", () => {
    const trpcLike = {
      message: "x",
      data: { code: "VALIDATION_ERROR", issues: "not-an-array" },
    };
    const err = AbadgeApiError.fromUnknown(trpcLike, "fallback");
    expect(err.issues).toBeUndefined();
  });

  test("preserves hint and meta from raw HTTP responses", async () => {
    const error = await AbadgeApiError.fromResponse(
      new Response(
        JSON.stringify({
          code: "FIELD_NOT_FOUND",
          error: "Field was not found on this item",
          hint: "Available fields: username, password.",
          meta: {
            field: "token",
          },
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
      "Fallback message",
    );

    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("FIELD_NOT_FOUND");
    expect(error.message).toBe("Field was not found on this item");
    expect(error.hint).toBe("Available fields: username, password.");
    expect(error.meta).toEqual({
      field: "token",
    });
  });

  test("fromResponse captures X-Request-Id header", async () => {
    const res = new Response(JSON.stringify({ error: "boom", code: "INTERNAL_ERROR" }), {
      status: 500,
      headers: { "content-type": "application/json", "X-Request-Id": "req_abc123" },
    });
    const err = await AbadgeApiError.fromResponse(res, "fallback");
    expect(err.requestId).toBe("req_abc123");
  });

  test("fromResponse requestId is case-insensitive on the header name", async () => {
    const res = new Response(JSON.stringify({ error: "boom", code: "INTERNAL_ERROR" }), {
      status: 500,
      headers: { "content-type": "application/json", "x-request-id": "req_lower" },
    });
    const err = await AbadgeApiError.fromResponse(res, "fallback");
    expect(err.requestId).toBe("req_lower");
  });

  test("fromResponse requestId is undefined when header absent", async () => {
    const res = new Response(JSON.stringify({ error: "boom", code: "INTERNAL_ERROR" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
    const err = await AbadgeApiError.fromResponse(res, "fallback");
    expect(err.requestId).toBeUndefined();
  });

  test("fromUnknown picks up requestId from error envelope meta", () => {
    const err = AbadgeApiError.fromUnknown(
      {
        message: "boom",
        data: { httpStatus: 500, code: "INTERNAL_ERROR", meta: { requestId: "req_from_meta" } },
      },
      "fallback",
    );
    expect(err.requestId).toBe("req_from_meta");
  });

  test("fromUnknown requestId is undefined when meta lacks it", () => {
    const err = AbadgeApiError.fromUnknown(
      { message: "boom", data: { httpStatus: 500, code: "INTERNAL_ERROR" } },
      "fallback",
    );
    expect(err.requestId).toBeUndefined();
  });
});
