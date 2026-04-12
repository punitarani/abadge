import { Command } from "commander";
import { createAgentApiClient } from "../client";
import { daemonExecEnv, daemonExpandEnv } from "../daemon";
import { error, errorMessage } from "../output";
import { resolveSecretValue } from "../secret";

export function createRunCommand(): Command {
  const cmd = new Command("run")
    .description("Run command with secret in env")
    .requiredOption("--item <id>", "Item ID")
    .option("--field <name>", "Named field to deliver from the item payload")
    .option("--env-var <name>", "Environment variable name", "ABADGE_SECRET")
    .option("--expand-env", "Inject every field as a separate env var")
    // Allow unrecognised positional args so `abadge run --item <id> -- <cmd> [args...]`
    // passes everything after `--` through as cmd.args.
    .allowExcessArguments()
    .action(
      async (
        opts: { item: string; field?: string; envVar: string; expandEnv?: boolean },
        cmd: Command,
      ) => {
        const command = cmd.args;

        if (command.length === 0) {
          error("No command specified. Usage: abadge run --item <id> -- <command>");
          process.exit(1);
        }

        const executable = command[0] as string;

        try {
          const client = await createAgentApiClient();

          if (opts.expandEnv) {
            // Expand all fields into separate env vars via daemon
            const mounted = await client.accessMount(opts.item, "env");
            const res = await daemonExpandEnv(
              mounted.storageMode === "zero_knowledge" ? mounted.encryptedItemKey : null,
              mounted.storageMode === "zero_knowledge" ? mounted.ciphertext : null,
              mounted.storageMode === "server_managed" ? mounted.payload : null,
              executable,
              command.slice(1),
            );
            process.exit(res.exitCode);
          } else {
            const secretValue = await resolveSecretValue(client, opts.item, "env", opts.field);
            const res = await daemonExecEnv(secretValue, opts.envVar, executable, command.slice(1));
            process.exit(res.exitCode);
          }
        } catch (err) {
          error(errorMessage(err, "Failed to run command."));
          process.exit(1);
        }
      },
    );

  return cmd;
}
