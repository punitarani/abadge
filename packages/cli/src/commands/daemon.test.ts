import { describe, expect, test } from "bun:test";
import { resolveCurrentCliCommand } from "./daemon";

describe("resolveCurrentCliCommand", () => {
  test("uses the script path when running from TypeScript", () => {
    expect(resolveCurrentCliCommand("packages/cli/bin/abadge.ts", "/usr/local/bin/bun")).toEqual({
      command: "/usr/local/bin/bun",
      args: [
        "/Users/punit/.codex/worktrees/35f1/abadge/packages/cli/bin/abadge.ts",
        "daemon",
        "serve",
      ],
    });
  });

  test("preserves argv shape for compiled binaries", () => {
    expect(resolveCurrentCliCommand("/usr/local/bin/abadge", "/usr/local/bin/abadge")).toEqual({
      command: "/usr/local/bin/abadge",
      args: ["/usr/local/bin/abadge", "daemon", "serve"],
    });
  });
});
