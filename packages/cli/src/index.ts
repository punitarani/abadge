import { approveCommand } from "./commands/approve";
import { auditCommand } from "./commands/audit";
import { connectorCommand } from "./commands/connector";
import { grantCommand } from "./commands/grant";
import { loginCommand } from "./commands/login";
import { mountCommand } from "./commands/mount";
import { runCommand } from "./commands/run";
import { secretCommand } from "./commands/secret";
import { whoamiCommand } from "./commands/whoami";

const VERSION = "0.0.0";

const HELP = `abadge — Agent credential firewall CLI

Commands:
  login              Authenticate with abadge
  whoami             Show current identity
  secret create      Store a new credential
  secret list        List credentials
  secret get         Get credential metadata
  grant create       Grant agent access to a credential
  grant list         List access grants
  run                Run a command with a secret injected as env var
  mount              Mount a secret as a temp file
  audit              View access audit log
  approve            Approve or deny a pending access request
  connector          Manage external vault connectors

Options:
  --help, -h         Show this help
  --version, -v      Show version
  --json             Output as JSON`;

export async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  const args = argv.slice(1);

  switch (command) {
    case "login":
      return loginCommand(args);
    case "whoami":
      return whoamiCommand(args);
    case "secret":
      return secretCommand(args);
    case "grant":
      return grantCommand(args);
    case "run":
      return runCommand(args);
    case "mount":
      return mountCommand(args);
    case "audit":
      return auditCommand(args);
    case "approve":
      return approveCommand(args);
    case "connector":
      return connectorCommand(args);
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
