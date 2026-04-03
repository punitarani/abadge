import { Command } from "commander";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { daemonExecMount } from "../daemon";
import { error, errorMessage, success } from "../output";
import { resolveSecretValue } from "../secret";

export async function mountCommand(args: string[]): Promise<void> {
  const cmd = new Command("mount")
    .description("Mount secret as temp file")
    .requiredOption("--item <id>", "Item ID")
    .action(async (opts: { item: string }) => {
      try {
        const client = new ApiClient(requireConfig());
        const secretValue = await resolveSecretValue(client, opts.item, "file");
        const res = await daemonExecMount(secretValue);
        if (!res.ok) {
          error(res.error ?? "Failed to mount item.");
          process.exit(1);
        }

        const data = res.data as { path?: string } | undefined;
        if (data?.path) {
          success(`Mounted at: ${data.path}`);
        } else {
          success("Item mounted.");
        }
      } catch (err) {
        error(errorMessage(err, "Failed to communicate with daemon."));
        process.exit(1);
      }
    });
  await cmd.parseAsync(args, { from: "user" });
}
