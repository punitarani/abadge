import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { resolveCurrentCliCommand } from "./daemon";

describe("resolveCurrentCliCommand", () => {
  test("uses the script path when running from TypeScript", () => {
    const entrypoint = resolve(import.meta.dir, "../../bin/abadge.ts");

    expect(resolveCurrentCliCommand(entrypoint, "/usr/local/bin/bun")).toEqual({
      command: "/usr/local/bin/bun",
      args: [entrypoint, "daemon", "serve"],
    });
  });

  test("preserves argv shape for compiled binaries", () => {
    expect(resolveCurrentCliCommand("/usr/local/bin/abadge", "/usr/local/bin/abadge")).toEqual({
      command: "/usr/local/bin/abadge",
      args: ["/usr/local/bin/abadge", "daemon", "serve"],
    });
  });
});
