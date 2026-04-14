import { describe, expect, test } from "bun:test";
import { normalizeTrpcError } from "./client";

describe("normalizeTrpcError", () => {
  test("returns a generic normalized error for non-object input", () => {
    expect(normalizeTrpcError(undefined)).toEqual({ message: "Unknown error" });
    expect(normalizeTrpcError(null)).toEqual({ message: "Unknown error" });
    expect(normalizeTrpcError("boom")).toEqual({ message: "Unknown error" });
  });

  test("preserves hint and meta from tRPC error data", () => {
    const mockTrpcErr = {
      message: "Not a member of the requested organization",
      data: {
        code: "UNAUTHORIZED",
        httpStatus: 401,
        hint: "Switch to an org you belong to.",
        meta: { orgId: "org-123" },
      },
    };

    const normalized = normalizeTrpcError(mockTrpcErr);

    expect(normalized.message).toBe("Not a member of the requested organization");
    expect(normalized.hint).toBe("Switch to an org you belong to.");
    expect(normalized.meta).toEqual({ orgId: "org-123" });
    expect(normalized.code).toBe("UNAUTHORIZED");
    expect(normalized.trpcCode).toBe("UNAUTHORIZED");
    expect(normalized.httpStatus).toBe(401);
  });

  test("omits hint and meta when absent from error data", () => {
    const mockTrpcErr = {
      message: "Something failed",
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
    };

    const normalized = normalizeTrpcError(mockTrpcErr);

    expect(normalized.hint).toBeUndefined();
    expect(normalized.meta).toBeUndefined();
  });

  test("ignores non-string hint and non-object meta", () => {
    const mockTrpcErr = {
      message: "Bad envelope",
      data: {
        code: "BAD_REQUEST",
        httpStatus: 400,
        hint: 42,
        meta: ["not", "an", "object"],
      },
    };

    const normalized = normalizeTrpcError(mockTrpcErr);

    expect(normalized.hint).toBeUndefined();
    expect(normalized.meta).toBeUndefined();
  });

  test("falls back to 'Request failed' when the error has no message", () => {
    const normalized = normalizeTrpcError({ data: { code: "FORBIDDEN", httpStatus: 403 } });
    expect(normalized.message).toBe("Request failed");
    expect(normalized.code).toBe("FORBIDDEN");
  });
});
