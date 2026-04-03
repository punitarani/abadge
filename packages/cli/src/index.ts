import { agentCommand } from "./commands/agent";
import { auditCommand } from "./commands/audit";
import { daemonCommand, daemonServeCommand } from "./commands/daemon";
import { itemCommand } from "./commands/item";
import { loginCommand } from "./commands/login";
import { mountCommand } from "./commands/mount";
import { permissionCommand } from "./commands/permission";
import { runCommand } from "./commands/run";
import { vaultCommand } from "./commands/vault";

const VERSION = "0.1.0";

const HELP = `abadge — Zero-knowledge credential vault CLI

Commands:
  login                     Authenticate with abadge
  daemon start|stop|status  Manage local daemon
  vault unlock|lock|status|change-password  Manage vault encryption
  item create|list|get|update|delete  Manage vault items
  agent register|list|rotate|revoke  Manage agents
  permission create|list|revoke  Manage access permissions
  run --item <id> -- <cmd>  Run command with secret in env
  mount --item <id>         Mount secret as temp file
  audit                     View access audit log

Options:
  --help, -h    Show this help
  --version, -v Show version`;

export async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  const args = argv.slice(1);

  switch (command) {
    case "login":
      return loginCommand(args);
    case "daemon":
      return daemonCommand(args);
    case "vault":
      return vaultCommand(args);
    case "item":
      return itemCommand(args);
    case "agent":
      return agentCommand(args);
    case "permission":
      return permissionCommand(args);
    case "run":
      return runCommand(args);
    case "mount":
      return mountCommand(args);
    case "audit":
      return auditCommand(args);
    case "__daemon-serve":
      return daemonServeCommand(args);
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    case "--version":
    case "-v":
      console.log(VERSION);
      return;
    default:
      console.log(HELP);
      process.exit(command ? 1 : 0);
  }
}
