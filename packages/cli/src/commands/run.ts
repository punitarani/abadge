import { Command } from "commander";
import { requireConfig } from "../config";
import { daemonExecEnv } from "../daemon";
import { error, errorMessage } from "../output";
import { createRuntimeClient } from "../runtime-agent";
import { resolveSecretValue } from "../secret";

export function createRunCommand(): Command {
  return new Command("run")
    .description("Run command with secret in env")
    .requiredOption("--item <id>", "Item ID")
    .allowExcessArguments()
    .action(async (opts: { item: string }, cmd: Command) => {
      const command = cmd.args;
      if (command.length === 0) {
        error("No command specified. Usage: abadge run --item <id> -- <command>");
        process.exit(1);
      }

      const executable = command[0] as string;

      try {
        const client = await createRuntimeClient("local_cli", requireConfig());
        const secretValue = await resolveSecretValue(client, opts.item, "env");
        const res = await daemonExecEnv(secretValue, "ABADGE_SECRET", executable, command.slice(1));
        if (!res.ok) {
          error(res.error ?? "Failed to run command.");
          process.exit(1);
        }

        const exitCode = (res.data as { exitCode?: number })?.exitCode ?? 0;
        process.exit(exitCode);
      } catch (err) {
        error(errorMessage(err, "Failed to communicate with daemon."));
        process.exit(1);
      }
    });
}
