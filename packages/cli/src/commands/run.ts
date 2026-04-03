import { Command } from "commander";
import { ApiClient } from "../client";
import { requirePrincipalConfig } from "../config";
import { daemonExecEnv } from "../daemon";
import { error, errorMessage } from "../output";
import { resolveSecretValue } from "../secret";

export function createRunCommand(): Command {
  const cmd = new Command("run")
    .description("Run command with secret in env")
    .requiredOption("--item <id>", "Item ID")
    .option("--env-var <name>", "Environment variable name", "ABADGE_SECRET")
    // Allow unrecognised positional args so `abadge run --item <id> -- <cmd> [args...]`
    // passes everything after `--` through as cmd.args.
    .allowExcessArguments()
    .action(async (opts: { item: string; envVar: string }, cmd: Command) => {
      const command = cmd.args;

      if (command.length === 0) {
        error("No command specified. Usage: abadge run --item <id> -- <command>");
        process.exit(1);
      }

      const executable = command[0] as string;

      try {
        const client = new ApiClient(requirePrincipalConfig());
        const secretValue = await resolveSecretValue(client, opts.item, "env");
        const res = await daemonExecEnv(secretValue, opts.envVar, executable, command.slice(1));
        process.exit(res.exitCode);
      } catch (err) {
        error(errorMessage(err, "Failed to run command."));
        process.exit(1);
      }
    });

  return cmd;
}
