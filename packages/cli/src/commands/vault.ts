import { Command } from "commander";
import { createProfileCommand } from "./profile";

/**
 * @deprecated The `vault` top-level command was renamed to `profile`. This
 * wrapper preserves the subcommands but prints a deprecation warning on every
 * invocation. Remove after the next major release.
 */
export function createVaultCommand(): Command {
  const vault = new Command("vault")
    .description("[deprecated] alias for 'profile'")
    .hook("preAction", () => {
      process.stderr.write("Warning: 'vault' is deprecated; use 'profile' instead.\n");
    });

  // Build a fresh profile tree for the alias. Re-attaching the same Command
  // instances from one parent to another re-parents them in commander, which
  // would break the original `profile` command tree.
  const freshProfileForAlias = createProfileCommand();
  for (const sub of freshProfileForAlias.commands) {
    vault.addCommand(sub);
  }

  return vault;
}
