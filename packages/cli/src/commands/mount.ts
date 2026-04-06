import { Command } from "commander";
import { ApiClient } from "../client";
import { requirePrincipalConfig } from "../config";
import { daemonExecMount } from "../daemon";
import { error, errorMessage, success } from "../output";
import { resolveSecretValue } from "../secret";

export function createMountCommand(): Command {
  return new Command("mount")
    .description("Mount secret as temp file")
    .requiredOption("--item <id>", "Item ID")
    .option("--path <path>", "Target mount path")
    .action(async (opts: { item: string; path?: string }) => {
      try {
        const client = new ApiClient(requirePrincipalConfig());
        const secretValue = await resolveSecretValue(client, opts.item, "file");
        const res = await daemonExecMount(secretValue, opts.path);
        success(`Mounted at: ${res.path}`);
      } catch (err) {
        error(errorMessage(err, "Failed to mount item."));
        process.exit(1);
      }
    });
}
