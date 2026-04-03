import { Command } from "commander";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { daemonExecEnv } from "../daemon";
import { error, errorMessage } from "../output";
import { resolveSecretValue } from "../secret";

export function createRunCommand(): Command {
  const cmd = new Command("run")
    .description("Run command with secret in env")
    .requiredOption("--item <id>", "Item ID")
    .allowExcessArguments()
    .action(async (opts: { item: string }) => {
      const command = cmd.args;

      if (command.length === 0) {
        error("No command specified. Usage: abadge run --item <id> -- <command>");
        process.exit(1);
      }

      const executable = command[0];
      if (!executable) {
        error("No command specified. Usage: abadge run --item <id> -- <command>");
        process.exit(1);
      }

      try {
        const client = new ApiClient(requireConfig());
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

  return cmd;
}

export async function runCommand(args: string[]): Promise<void> {
  await createRunCommand().parseAsync(args, { from: "user" });
}
