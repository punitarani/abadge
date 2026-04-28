import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { AbadgeApiError } from "@abadge/sdk";
import { error, errorMessage, json, success, table, warn } from "./output";

const captured: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };

beforeEach(() => {
  captured.stdout = [];
  captured.stderr = [];
  spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    captured.stdout.push(args.map(String).join(" "));
  });
  spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    captured.stderr.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  spyOn(console, "log").mockRestore();
  spyOn(console, "error").mockRestore();
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape filtering is intentional
const ANSI = /\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI, "");

describe("output formatting", () => {
  test("success prefixes with green check mark", () => {
    success("done");
    expect(captured.stdout).toHaveLength(1);
    expect(stripAnsi(captured.stdout[0] ?? "")).toBe("✓ done");
  });

  test("error writes to stderr with red X", () => {
    error("bad");
    expect(captured.stderr).toHaveLength(1);
    expect(stripAnsi(captured.stderr[0] ?? "")).toBe("✗ bad");
  });

  test("warn writes to stderr with yellow !", () => {
    warn("careful");
    expect(captured.stderr).toHaveLength(1);
    expect(stripAnsi(captured.stderr[0] ?? "")).toBe("! careful");
  });

  test("json pretty-prints data to stdout", () => {
    json({ ok: true, items: [1, 2] });
    expect(captured.stdout).toHaveLength(1);
    expect(captured.stdout[0]).toBe(`{\n  "ok": true,\n  "items": [\n    1,\n    2\n  ]\n}`);
  });
});

describe("table()", () => {
  test("(no results) for empty rows", () => {
    table([]);
    expect(captured.stdout).toEqual(["(no results)"]);
  });

  test("renders header + separator + rows aligned to widest cell", () => {
    table([
      { Name: "alpha", Score: "1" },
      { Name: "bravo-charlie", Score: "100" },
    ]);
    const lines = captured.stdout.map(stripAnsi);
    expect(lines).toHaveLength(4); // header, separator, two rows
    expect(lines[0]).toBe("Name           Score");
    expect(lines[1]).toBe("─────────────  ─────");
    expect(lines[2]).toBe("alpha          1    ");
    expect(lines[3]).toBe("bravo-charlie  100  ");
  });

  test("missing or undefined cell values render as empty padding", () => {
    table([
      { A: "x", B: "y" },
      // intentionally missing the B column for the second row
      { A: "longer" } as unknown as Record<string, string>,
    ]);
    const lines = captured.stdout.map(stripAnsi);
    expect(lines[2]).toBe("x       y");
    expect(lines[3]).toBe("longer   ");
  });
});

describe("errorMessage()", () => {
  test("renders hint underneath when error is AbadgeApiError with hint", () => {
    const err = new AbadgeApiError(
      403,
      "PERMISSION_DENIED",
      "Agent lacks mount_env",
      "Grant mount_env via abadge permission grant",
    );
    const out = stripAnsi(errorMessage(err, "fallback"));
    expect(out).toBe("Agent lacks mount_env\n  → Grant mount_env via abadge permission grant");
  });

  test("just the message when AbadgeApiError has no hint", () => {
    const err = new AbadgeApiError(404, "ITEM_NOT_FOUND", "Item not found");
    expect(stripAnsi(errorMessage(err, "fallback"))).toBe("Item not found");
  });

  test("plain Error returns its message", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  test("non-Error value falls back to the supplied default", () => {
    expect(errorMessage("not an error", "default fallback")).toBe("default fallback");
    expect(errorMessage(null, "fallback-2")).toBe("fallback-2");
  });
});
