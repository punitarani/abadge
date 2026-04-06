import { Command } from "commander";
import packageJson from "../package.json";
import { createAgentCommand } from "./commands/agent";
import { createAuditCommand } from "./commands/audit";
import { createDaemonCommand } from "./commands/daemon";
import { createItemCommand } from "./commands/item";
import { createLoginCommand } from "./commands/login";
import { createMountCommand } from "./commands/mount";
import { createPermissionCommand } from "./commands/permission";
import { createRunCommand } from "./commands/run";
import { createVaultCommand } from "./commands/vault";

const program = new Command()
  .name("abadge")
  .description("Zero-knowledge credential vault CLI")
  .version(packageJson.version, "-v, --version");

program.addCommand(createLoginCommand());
program.addCommand(createDaemonCommand());
program.addCommand(createVaultCommand());
program.addCommand(createItemCommand());
program.addCommand(createAgentCommand());
program.addCommand(createPermissionCommand());
program.addCommand(createRunCommand());
program.addCommand(createMountCommand());
program.addCommand(createAuditCommand());

export { program };

export async function main(argv: string[]): Promise<void> {
  await program.parseAsync(argv, { from: "user" });
}
