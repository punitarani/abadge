import type { Command } from "commander";

/**
 * Deprecated-verb aliases for PR 4's verb canonicalization
 * (create -> add, delete -> rm, register -> add, revoke -> rm).
 *
 * Each entry attaches a hidden subcommand on `parentName` that:
 *   1. Prints `DEPRECATED: 'abadge <noun> <oldVerb>' is deprecated; use 'abadge <noun> <newVerb>'` to stderr.
 *   2. Re-dispatches the remaining args to the new verb on the same parent.
 *
 * The alias is hidden from `--help` so the canonical verb is the only one
 * surfaced to new users. Existing scripts and muscle memory keep working.
 */
const ALIASES: ReadonlyArray<readonly [noun: string, oldVerb: string, newVerb: string]> = [
  ["item", "create", "add"],
  ["item", "delete", "rm"],
  ["agent", "register", "add"],
  ["agent", "revoke", "rm"],
  ["profile", "create", "add"],
  ["profile", "delete", "rm"],
  ["org", "create", "add"],
  ["org", "delete", "rm"],
];

function findChild(parent: Command, name: string): Command | undefined {
  return parent.commands.find((c) => c.name() === name);
}

/**
 * Walk the program tree and attach a hidden deprecated alias for each
 * (noun, oldVerb -> newVerb) tuple. Idempotent: if the new verb is missing
 * the tuple is skipped (lets us land verb renames incrementally without
 * breaking the CLI bootstrap).
 */
export function registerDeprecatedAliases(program: Command): void {
  for (const [noun, oldVerb, newVerb] of ALIASES) {
    const parent = findChild(program, noun);
    if (!parent) continue;
    const target = findChild(parent, newVerb);
    if (!target) continue;
    if (findChild(parent, oldVerb)) continue; // primary still exists; nothing to do

    parent
      .command(oldVerb, { hidden: true })
      .description(`[deprecated] alias for '${noun} ${newVerb}'`)
      .allowUnknownOption(true)
      .helpOption(false)
      .argument("[args...]", "")
      .action(async (_args, _opts, sub) => {
        process.stderr.write(
          `DEPRECATED: 'abadge ${noun} ${oldVerb}' is deprecated; use 'abadge ${noun} ${newVerb}'.\n`,
        );
        // Re-dispatch: rewrite argv from "<noun> <oldVerb> ..." to "<noun> <newVerb> ..."
        // and ask commander to parse the result on the same root program.
        // sub.parent === parent; sub.parent.parent === program (when wired
        // by registerDeprecatedAliases). raw is everything after the alias name.
        const raw = sub.args ?? [];
        await program.parseAsync([noun, newVerb, ...raw], { from: "user" });
      });
  }
}
