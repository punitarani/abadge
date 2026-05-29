import { describe, expect, test } from "bun:test";
import { ServiceUnavailableError } from "@abadge/core";
import { TRPCError } from "@trpc/server";
import { errorEnvelope, statusFromError } from "./v1";

// §F — the v1 REST surface maps errors to HTTP status independently of the
// tRPC fetch adapter (it switches on the tRPC error code). A 503 must reach
// the wire on BOTH surfaces, so the SERVICE_UNAVAILABLE code needs an explicit
// case here too — otherwise it would fall through to `default: 500`.
describe("statusFromError — SERVICE_UNAVAILABLE (§F)", () => {
  const serviceUnavailable = new ServiceUnavailableError({
    code: "SERVICE_UNAVAILABLE",
    message: "Service temporarily unavailable.",
    hint: "The database is at capacity or briefly unreachable. Retry after a short backoff.",
    meta: { retryAfterSeconds: 2 },
  });

  test("a wrapped SERVICE_UNAVAILABLE TRPCError → 503 (not the default 500)", () => {
    const wrapped = new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: serviceUnavailable.message,
      cause: serviceUnavailable,
    });
    expect(statusFromError(wrapped)).toBe(503);
  });

  test("a bare ServiceUnavailableError domain error → 503", () => {
    expect(statusFromError(serviceUnavailable)).toBe(503);
  });

  test("the envelope unwraps the cause to the full domain shape", () => {
    const wrapped = new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: serviceUnavailable.message,
      cause: serviceUnavailable,
    });
    expect(errorEnvelope(wrapped)).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "Service temporarily unavailable.",
      hint: "The database is at capacity or briefly unreachable. Retry after a short backoff.",
      meta: { retryAfterSeconds: 2 },
    });
  });

  test("regression: a genuine INTERNAL_SERVER_ERROR still maps to 500", () => {
    const err = new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "boom" });
    expect(statusFromError(err)).toBe(500);
  });
});
