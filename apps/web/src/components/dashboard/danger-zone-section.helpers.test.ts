import { describe, expect, test } from "bun:test";
import { classifyDeletionError, evaluateDeleteGate } from "./danger-zone-section.helpers";

/**
 * Shape a fake tRPC client error the way `normalizeTrpcError` reads it: the
 * domain code lives on `data.code`, the human message on `message`.
 */
function trpcError(code: string, message = `failed: ${code}`): unknown {
  return { data: { code, httpStatus: 400 }, message };
}

describe("evaluateDeleteGate", () => {
  const base = { confirmName: "Acme Inc", password: "", pending: false };

  test("a non-matching name blocks submission", () => {
    const gate = evaluateDeleteGate({ ...base, confirmText: "acme inc", password: "pw" });
    expect(gate.nameMatches).toBe(false);
    expect(gate.canSubmit).toBe(false);
  });

  test("trailing whitespace in the typed name still matches", () => {
    const gate = evaluateDeleteGate({ ...base, confirmText: "  Acme Inc  ", password: "pw" });
    expect(gate.nameMatches).toBe(true);
    expect(gate.canSubmit).toBe(true);
  });

  test("a matching name without a password cannot submit", () => {
    const gate = evaluateDeleteGate({ ...base, confirmText: "Acme Inc" });
    expect(gate.nameMatches).toBe(true);
    expect(gate.canSubmit).toBe(false);
  });

  test("an in-flight request cannot submit even when both gates pass", () => {
    const gate = evaluateDeleteGate({
      ...base,
      confirmText: "Acme Inc",
      password: "pw",
      pending: true,
    });
    expect(gate.nameMatches).toBe(true);
    expect(gate.canSubmit).toBe(false);
  });
});

describe("classifyDeletionError", () => {
  test("a wrong password is routed to the password field", () => {
    const failure = classifyDeletionError(trpcError("REAUTH_FAILED"), "fallback");
    expect(failure.kind).toBe("password");
    if (failure.kind === "password") {
      expect(failure.message).toMatch(/incorrect password/i);
    }
  });

  test("an already-deleted workspace is treated as gone, not an error", () => {
    const failure = classifyDeletionError(trpcError("NOT_FOUND"), "fallback");
    expect(failure.kind).toBe("gone");
  });

  test("a no-password (social-login) failure becomes a form-level banner", () => {
    const failure = classifyDeletionError(
      trpcError("REAUTH_PASSWORD_REQUIRED", "Account has no password set"),
      "fallback",
    );
    expect(failure.kind).toBe("form");
    if (failure.kind === "form") {
      expect(failure.message).toContain("no password");
    }
  });

  test("an insufficient-role failure becomes a form-level banner", () => {
    const failure = classifyDeletionError(trpcError("FORBIDDEN", "Forbidden"), "fallback");
    expect(failure.kind).toBe("form");
  });

  test("an unrecognized error falls back to a form-level banner", () => {
    const failure = classifyDeletionError({}, "Failed to delete organization");
    expect(failure.kind).toBe("form");
    if (failure.kind === "form") {
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });
});
