import { Command } from "commander";
import { createAgentCommand } from "./commands/agent";
import { createAuditCommand } from "./commands/audit";
import { createDaemonCommand, createDaemonServeCommand } from "./commands/daemon";
import { createItemCommand } from "./commands/item";
import { createLoginCommand } from "./commands/login";
import { createLogoutCommand } from "./commands/logout";
import { createMountCommand } from "./commands/mount";
import { createPermissionCommand } from "./commands/permission";
import { createRunCommand } from "./commands/run";
import { createVaultCommand } from "./commands/vault";

const program = new Command()
  .name("abadge")
  .description("Zero-knowledge credential vault CLI")
  .version("0.1.0", "-v, --version");

program.addCommand(createLoginCommand());
program.addCommand(createLogoutCommand());
program.addCommand(createDaemonCommand());
program.addCommand(createVaultCommand());
program.addCommand(createItemCommand());
program.addCommand(createAgentCommand());
program.addCommand(createPermissionCommand());
program.addCommand(createRunCommand());
program.addCommand(createMountCommand());
program.addCommand(createAuditCommand());
program.addCommand(createDaemonServeCommand(), { hidden: true });

export { program };

export async function main(argv: string[]): Promise<void> {
  await program.parseAsync(argv, { from: "user" });
}
