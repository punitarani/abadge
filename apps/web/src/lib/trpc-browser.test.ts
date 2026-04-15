import { describe, expect, test } from "bun:test";
import { getClientErrorMessage } from "./client-error-message";

function makeTrpcError(params: {
  message: string;
  code?: string;
  httpStatus?: number;
  hint?: string;
  meta?: Record<string, unknown>;
  issues?: unknown;
}) {
  return {
    message: params.message,
    data: {
      code: params.code ?? "INTERNAL_SERVER_ERROR",
      httpStatus: params.httpStatus ?? 500,
      ...(params.hint !== undefined ? { hint: params.hint } : {}),
      ...(params.meta !== undefined ? { meta: params.meta } : {}),
      ...(params.issues !== undefined ? { issues: params.issues } : {}),
    },
  };
}

describe("getClientErrorMessage", () => {
  test("returns the normalized 'Unknown error' for empty errors", () => {
    // The existing contract: normalizeTrpcError maps non-objects to
    // "Unknown error", which short-circuits the fallback. B2 must not change
    // that behavior — it only changes how hints are surfaced.
    expect(getClientErrorMessage(undefined, "Something went wrong")).toBe("Unknown error");
  });

  test("returns the server message when no hint is present", () => {
    const err = makeTrpcError({ message: "Not a member of the org", code: "UNAUTHORIZED" });
    expect(getClientErrorMessage(err, "Failed")).toBe("Not a member of the org");
  });

  test("appends the server hint to the message with an em dash", () => {
    const err = makeTrpcError({
      message: "Not a member of the requested organization",
      code: "UNAUTHORIZED",
      hint: "Switch to an org you belong to.",
    });
    expect(getClientErrorMessage(err, "Failed")).toBe(
      "Not a member of the requested organization — Switch to an org you belong to.",
    );
  });

  test("does not duplicate the hint if the server already merged it into the message", () => {
    const hint = "Switch to an org you belong to.";
    const err = makeTrpcError({
      message: `Not a member of the requested organization. ${hint}`,
      code: "UNAUTHORIZED",
      hint,
    });
    expect(getClientErrorMessage(err, "Failed")).toBe(
      `Not a member of the requested organization. ${hint}`,
    );
  });

  test("does not dedupe when hint appears mid-message (not anchored at end)", () => {
    const hint = "Try again.";
    const err = makeTrpcError({
      message: `Check the password, ${hint} Please correct and retry.`,
      code: "BAD_REQUEST",
      hint,
    });
    expect(getClientErrorMessage(err, "Failed")).toBe(
      `Check the password, ${hint} Please correct and retry. — ${hint}`,
    );
  });

  test("prefers a formatted validation issue over the top-level message and still appends the hint", () => {
    const err = makeTrpcError({
      message: "Input validation failed",
      code: "BAD_REQUEST",
      hint: "Check the highlighted fields.",
      issues: [{ path: ["name"], message: "Required" }],
    });
    expect(getClientErrorMessage(err, "Failed")).toBe(
      "name: Required — Check the highlighted fields.",
    );
  });
});
