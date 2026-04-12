import { describe, expect, test } from "bun:test";
import { AbadgeApiError } from "./errors";

describe("AbadgeApiError", () => {
  test("preserves hint and meta from normalized tRPC errors", () => {
    const error = AbadgeApiError.fromUnknown(
      {
        message: "Remote agents cannot mount env vars",
        data: {
          httpStatus: 400,
          code: "BAD_REQUEST",
          appCode: "INVALID_CAPABILITY_LOCALITY",
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
});
