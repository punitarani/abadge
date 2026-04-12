import type { AbadgeAgentClient } from "@abadge/sdk";
import { Command } from "commander";
import { createAgentApiClient } from "../client";
import { daemonExpandEnv } from "../daemon";
import { error, errorMessage } from "../output";
import { resolveSecretValue } from "../secret";

async function runWithExpandEnv(
  client: AbadgeAgentClient,
  itemId: string,
  executable: string,
  args: string[],
): Promise<never> {
  try {
    const mounted = await client.accessMount(itemId, "env");
    const res = await daemonExpandEnv(
      mounted.storageMode === "zero_knowledge" ? mounted.encryptedItemKey : null,
      mounted.storageMode === "zero_knowledge" ? mounted.ciphertext : null,
      mounted.storageMode === "server_managed" ? mounted.payload : null,
      executable,
      args,
    );
    process.exit(res.exitCode);
  } catch {
    throw new Error(
      "--expand-env requires the local daemon.\n" +
        "hint: Start it with: abadge daemon start\n" +
        "hint: Daemonless --expand-env support is coming in v0.1.",
    );
  }
}

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
            await runWithExpandEnv(client, opts.item, executable, command.slice(1));
          } else {
            const secretValue = await resolveSecretValue(client, opts.item, "env", opts.field);
            const proc = Bun.spawn([executable, ...command.slice(1)], {
              env: { ...process.env, [opts.envVar]: secretValue },
              stdout: "inherit",
              stderr: "inherit",
              stdin: "inherit",
            });
            const exitCode = await proc.exited;
            process.exit(exitCode);
          }
        } catch (err) {
          error(errorMessage(err, "Failed to run command."));
          process.exit(1);
        }
      },
    );

  return cmd;
}
