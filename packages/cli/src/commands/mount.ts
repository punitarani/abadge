import { Command } from "commander";
import { createAgentApiClient } from "../client";
import { daemonExecMount } from "../daemon";
import { error, errorMessage, success } from "../output";
import { resolveSecretValue } from "../secret";

export function createMountCommand(): Command {
  return new Command("mount")
    .description("Mount secret as temp file")
    .requiredOption("--item <id>", "Item ID")
    .option("--field <name>", "Named field to deliver from the item payload")
    .option("--path <path>", "Target mount path")
    .action(async (opts: { item: string; field?: string; path?: string }) => {
      try {
        const client = await createAgentApiClient();
        const secretValue = await resolveSecretValue(client, opts.item, "file", opts.field);
        const res = await daemonExecMount(secretValue, opts.path);
        success(`Mounted at: ${res.path}`);
      } catch (err) {
        error(errorMessage(err, "Failed to mount item."));
        process.exit(1);
      }
    });
}
