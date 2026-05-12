import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import { registerDeprecatedAliases } from "./aliases";

function buildProgramWithItemAdd(handler: (label: string) => void): Command {
  const program = new Command().name("abadge").exitOverride();
  const item = new Command("item");
  item
    .command("add")
    .option("--label <label>", "Label")
    .action((opts: { label?: string }) => handler(opts.label ?? ""));
  program.addCommand(item);
  registerDeprecatedAliases(program);
  return program;
}

describe("registerDeprecatedAliases", () => {
  let stderr: ReturnType<typeof spyOn>;
  beforeEach(() => {
    stderr = spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  });
  afterEach(() => {
    stderr.mockRestore();
  });

  test("hidden 'item create' alias re-dispatches to 'item add'", async () => {
    const received = { value: "" };
    const program = buildProgramWithItemAdd((label) => {
      received.value = label;
    });
    await program.parseAsync(["item", "create", "--label", "foo"], { from: "user" });

    expect(received.value).toBe("foo");
    const stderrCalls = (stderr.mock.calls as unknown as string[][])
      .flat()
      .filter((c) => typeof c === "string");
    expect(stderrCalls.join("")).toContain("DEPRECATED: 'abadge item create'");
    expect(stderrCalls.join("")).toContain("use 'abadge item add'");
  });

  test("noun without the new verb is skipped (no crash)", () => {
    const program = new Command().name("abadge");
    const empty = new Command("item");
    program.addCommand(empty);
    // No 'add' subcommand exists; helper should silently skip.
    expect(() => registerDeprecatedAliases(program)).not.toThrow();
    expect(empty.commands.find((c) => c.name() === "create")).toBeUndefined();
  });
});
