import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { resolveDaemonCommand } from "./daemon";

describe("resolveDaemonCommand", () => {
  test("uses the script path when running from TypeScript", () => {
    const entrypoint = resolve(import.meta.dir, "../../bin/abadge.ts");

    expect(resolveDaemonCommand(entrypoint, "/usr/local/bin/bun")).toEqual({
      executable: "/usr/local/bin/bun",
      args: [entrypoint, "__daemon-serve"],
    });
  });

  test("preserves argv shape for compiled binaries", () => {
    expect(resolveDaemonCommand("/usr/local/bin/abadge", "/usr/local/bin/abadge")).toEqual({
      executable: "/usr/local/bin/abadge",
      args: ["/usr/local/bin/abadge", "__daemon-serve"],
    });
  });
});
