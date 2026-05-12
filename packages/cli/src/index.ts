import { Command } from "commander";
import packageJson from "../package.json";
import { createAgentCommand } from "./commands/agent";
import { registerDeprecatedAliases } from "./commands/aliases";
import { createAuditCommand } from "./commands/audit";
import { createDaemonCommand } from "./commands/daemon";
import { createExportCommand } from "./commands/export-cmd";
import { createImportCommand } from "./commands/import-cmd";
import { createItemCommand } from "./commands/item";
import { createLoginCommand, createLogoutCommand } from "./commands/login";
import { createMountCommand } from "./commands/mount";
import { createOrgCommand } from "./commands/org";
import { createPermissionCommand } from "./commands/permission";
import { createProfileCommand } from "./commands/profile";
import { createRunCommand } from "./commands/run";
import { createUseCommand } from "./commands/use";

const program = new Command()
  .name("abadge")
  .description("Credential control plane for AI agents")
  .version(packageJson.version, "-v, --version")
  .option("--token-stdin", "Read a bearer session token from stdin for this command");

program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createDaemonCommand());
program.addCommand(createItemCommand());
program.addCommand(createAgentCommand());
program.addCommand(createPermissionCommand());
program.addCommand(createRunCommand());
program.addCommand(createMountCommand());
program.addCommand(createAuditCommand());
program.addCommand(createOrgCommand());
program.addCommand(createProfileCommand());
program.addCommand(createUseCommand());
program.addCommand(createImportCommand());
program.addCommand(createExportCommand());

// Attach hidden deprecated-verb aliases (create -> add, delete -> rm, etc.).
// Must run after every primary command is registered.
registerDeprecatedAliases(program);

export { program };

export async function main(argv: string[]): Promise<void> {
  await program.parseAsync(argv, { from: "user" });
}
