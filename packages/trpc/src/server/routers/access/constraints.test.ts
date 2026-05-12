import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "@abadge/core";
import { checkActionConstraint, isActionAllowed } from "./constraints";

describe("checkActionConstraint", () => {
  // Combinations enumerated (action × locality × storageMode = 2×2×2 = 8).

  test("read + local + server_managed: allowed", () => {
    expect(() =>
      checkActionConstraint({
        action: "read",
        locality: "local",
        storageMode: "server_managed",
      }),
    ).not.toThrow();
  });

  test("read + local + zero_knowledge: allowed (envelope to client)", () => {
    expect(() =>
      checkActionConstraint({
        action: "read",
        locality: "local",
        storageMode: "zero_knowledge",
      }),
    ).not.toThrow();
  });

  test("read + remote + server_managed: allowed", () => {
    expect(() =>
      checkActionConstraint({
        action: "read",
        locality: "remote",
        storageMode: "server_managed",
      }),
    ).not.toThrow();
  });

  test("read + remote + zero_knowledge: denied (INVALID_CAPABILITY)", () => {
    let thrown: unknown;
    try {
      checkActionConstraint({
        action: "read",
        locality: "remote",
        storageMode: "zero_knowledge",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ForbiddenError);
    expect((thrown as ForbiddenError).code).toBe("INVALID_CAPABILITY");
  });

  test("use + local + server_managed: allowed", () => {
    expect(() =>
      checkActionConstraint({
        action: "use",
        locality: "local",
        storageMode: "server_managed",
      }),
    ).not.toThrow();
  });

  test("use + local + zero_knowledge: allowed", () => {
    expect(() =>
      checkActionConstraint({
        action: "use",
        locality: "local",
        storageMode: "zero_knowledge",
      }),
    ).not.toThrow();
  });

  test("use + remote + server_managed: denied (INVALID_CAPABILITY)", () => {
    let thrown: unknown;
    try {
      checkActionConstraint({
        action: "use",
        locality: "remote",
        storageMode: "server_managed",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ForbiddenError);
    expect((thrown as ForbiddenError).code).toBe("INVALID_CAPABILITY");
  });

  test("use + remote + zero_knowledge: denied (INVALID_CAPABILITY)", () => {
    // Two rules collide (remote+ZK and remote+use). Implementation checks
    // remote+ZK first so the message points at the storage-mode mismatch.
    let thrown: unknown;
    try {
      checkActionConstraint({
        action: "use",
        locality: "remote",
        storageMode: "zero_knowledge",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ForbiddenError);
    expect((thrown as ForbiddenError).code).toBe("INVALID_CAPABILITY");
  });
});

describe("isActionAllowed", () => {
  test("returns true for allowed combos", () => {
    expect(
      isActionAllowed({ action: "read", locality: "local", storageMode: "server_managed" }),
    ).toBe(true);
    expect(
      isActionAllowed({ action: "use", locality: "local", storageMode: "zero_knowledge" }),
    ).toBe(true);
  });

  test("returns false for denied combos", () => {
    expect(
      isActionAllowed({ action: "read", locality: "remote", storageMode: "zero_knowledge" }),
    ).toBe(false);
    expect(
      isActionAllowed({ action: "use", locality: "remote", storageMode: "server_managed" }),
    ).toBe(false);
  });
});
