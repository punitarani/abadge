import type { BulkMountEnvItem } from "@abadge/core";
import type { BulkExecItem } from "@abadge/daemon";
import { type AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";
import { Command } from "commander";
import { createAgentApiClient } from "../client";
import { loadConfig } from "../config";
import { daemonExpandEnv, daemonExpandEnvBulk } from "../daemon";
import { error, errorMessage } from "../output";
import { resolveSecretValue } from "../secret";

export async function runWithExpandEnv(
  client: AbadgeAgentClient,
  itemId: string,
  executable: string,
  args: string[],
): Promise<never> {
  // accessMount may surface API errors (e.g. PERMISSION_DENIED) that carry a
  // hint. Resolve the mount first so those propagate untouched; only the
  // subsequent daemon call gets the daemon-availability fallback.
  const mounted = await client.accessMount(itemId, "env");
  try {
    // §W1S7-001 — ZK path needs (profileId, itemId, contentVersion) to rebuild
    // the XChaCha20-Poly1305 AAD in the daemon; server-managed path has nothing
    // to decrypt here so the meta is null.
    const zkMeta =
      mounted.storageMode === "zero_knowledge"
        ? {
            profileId: mounted.profileId,
            itemId: mounted.itemId,
            contentVersion: mounted.contentVersion,
          }
        : null;
    const res = await daemonExpandEnv(
      mounted.storageMode === "zero_knowledge" ? mounted.encryptedItemKey : null,
      mounted.storageMode === "zero_knowledge" ? mounted.ciphertext : null,
      mounted.storageMode === "server_managed" ? mounted.payload : null,
      executable,
      args,
      zkMeta,
    );
    process.exit(res.exitCode);
  } catch (err) {
    if (err instanceof AbadgeApiError) {
      throw err;
    }
    throw new Error(
      "--expand-env requires the local daemon.\n" +
        "hint: Start it with: abadge daemon start\n" +
        "hint: Daemonless --expand-env support is coming in v0.1.",
      { cause: err },
    );
  }
}

/**
 * Convert the API's BulkMountEnvItem (typed by Effect Schema) into the
 * daemon's BulkExecItem (a plain TS union). The shapes are isomorphic but
 * the readonly modifiers from Effect's Schema.Array don't survive the
 * cross-package boundary cleanly.
 */
function toBulkExecItem(item: BulkMountEnvItem): BulkExecItem {
  if (item.storageMode === "zero_knowledge") {
    return {
      itemId: item.itemId,
      label: item.label,
      storageMode: "zero_knowledge",
      encryptedItemKey: item.encryptedItemKey,
      ciphertext: item.ciphertext,
      profileId: item.profileId,
      contentVersion: item.contentVersion,
    };
  }
  return {
    itemId: item.itemId,
    label: item.label,
    storageMode: "server_managed",
    payload: item.payload,
  };
}

export async function runWithAll(
  client: AbadgeAgentClient,
  profileId: string,
  executable: string,
  args: string[],
): Promise<never> {
  const bulk = await client.bulkAccessMountEnv(profileId);
  try {
    const items = bulk.items.map(toBulkExecItem);
    const res = await daemonExpandEnvBulk(items, executable, args);
    process.exit(res.exitCode);
  } catch (err) {
    if (err instanceof AbadgeApiError) {
      throw err;
    }
    throw new Error(
      "--all requires the local daemon.\n" +
        "hint: Start it with: abadge daemon start && abadge vault unlock",
      { cause: err },
    );
  }
}

export function createRunCommand(): Command {
  const cmd = new Command("run")
    .description("Run command with secret in env")
    .option("--item <id>", "Item ID — single-secret mode")
    .option(
      "--all",
      "Bulk mode: inject every item in the active profile that the agent has mount_env on, with each item's label normalized to ENV_VAR_NAME",
    )
    .option(
      "--profile <id>",
      "Override the active profile when using --all (defaults to ~/.abadge/config.json::activeProfileId)",
    )
    .option("--field <name>", "Named field to deliver from the item payload (single-item mode)")
    .option("--env-var <name>", "Environment variable name (single-item mode)", "ABADGE_SECRET")
    .option(
      "--expand-env",
      "Inject every field of one item as a separate env var (single-item mode)",
    )
    // Allow unrecognised positional args so `abadge run --item <id> -- <cmd> [args...]`
    // passes everything after `--` through as cmd.args.
    .allowExcessArguments()
    .action(
      async (
        opts: {
          item?: string;
          all?: boolean;
          profile?: string;
          field?: string;
          envVar: string;
          expandEnv?: boolean;
        },
        cmd: Command,
      ) => {
        const command = cmd.args;

        if (command.length === 0) {
          error(
            "No command specified. Usage: abadge run --item <id> -- <command>  OR  abadge run --all -- <command>",
          );
          process.exit(1);
        }

        if (opts.all && opts.item) {
          error("--all and --item are mutually exclusive. Pick one.");
          process.exit(1);
        }
        if (!opts.all && !opts.item) {
          error(
            "Specify --item <id> for single-secret mode or --all for bulk-inject mode.\nhint: --all bulk-injects every item in the active profile that the agent has mount_env on.",
          );
          process.exit(1);
        }

        const executable = command[0] as string;

        try {
          const client = await createAgentApiClient();

          if (opts.all) {
            const profileId = opts.profile ?? loadConfig()?.activeProfileId;
            if (!profileId) {
              error(
                "No active profile. Run `abadge profile use <name>` first, or pass --profile <id>.",
              );
              process.exit(1);
            }
            await runWithAll(client, profileId, executable, command.slice(1));
          } else if (opts.expandEnv) {
            // opts.item is guaranteed by the mutex check above.
            await runWithExpandEnv(client, opts.item as string, executable, command.slice(1));
          } else {
            const secretValue = await resolveSecretValue(
              client,
              opts.item as string,
              "env",
              opts.field,
            );
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
