import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { createAgentApiClient } from "../client";
import { error, errorMessage, success } from "../output";
import { resolveSecretValue } from "../secret";

export function createMountCommand(): Command {
  return new Command("mount")
    .description("Write a secret to a temp file with 0600 permissions")
    .requiredOption("--item <id>", "Item ID")
    .option("--field <name>", "Named field to deliver from the item payload")
    .option("--path <path>", "Target mount path (default: a random file under the temp directory)")
    .action(async (opts: { item: string; field?: string; path?: string }) => {
      let client: Awaited<ReturnType<typeof createAgentApiClient>> | undefined;
      try {
        client = await createAgentApiClient();
        const secretValue = await resolveSecretValue(client, opts.item, "file", opts.field);

        const targetPath = opts.path ?? join(tmpdir(), `abadge-${crypto.randomUUID()}`);
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, secretValue, { mode: 0o600 });

        success(`Mounted at: ${targetPath}`);
      } catch (err) {
        error(errorMessage(err, "Failed to mount item."));
        client?.disconnect();
        process.exit(1);
      }
      client?.disconnect();
    });
}
