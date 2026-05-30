import type { RedeemMountResponse } from "@abadge/core";
import type { BulkExecItem } from "@abadge/daemon";
import { type AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";
import { Command } from "commander";
import { createAgentApiClient } from "../client";
import { loadConfig } from "../config";
import { daemonExpandEnv, daemonExpandEnvBulk } from "../daemon";
import { error, errorMessage } from "../output";
import { resolveSecretValue } from "../secret";

/** Run an item via the unified `access.use` → `redeemMount` → daemon path. */
export async function runWithUseRedeem(
  client: AbadgeAgentClient,
  itemId: string,
  executable: string,
  args: string[],
): Promise<never> {
  // 1. Mint a mount handle (server records the reservation + audit row).
  const handle = await client.access.use({ itemId }, { delivery: "env" });
  if (!("mountId" in handle)) {
    // The agent.access.use overload that takes `{ itemId }` always returns a
    // UseAccessResponse; this branch exists to satisfy the static type union
    // and should never fire at runtime.
    throw new AbadgeApiError(
      500,
      "INTEGRITY_ERROR",
      "access.use returned a profile-shaped response for an item target",
      "This indicates a server/client version skew; report a bug.",
    );
  }
  // 2. Atomically consume the handle and receive the underlying envelope /
  //    decrypted payload. Stolen / replayed handles fail here with
  //    MOUNT_NOT_FOUND before any subprocess is spawned.
  const redeemed: RedeemMountResponse = await client.access.redeemMount(handle.mountId);

  try {
    const zkMeta =
      redeemed.storageMode === "zero_knowledge"
        ? {
            profileId: redeemed.profileId,
            itemId: redeemed.itemId,
            contentVersion: redeemed.contentVersion,
          }
        : null;
    const res = await daemonExpandEnv(
      redeemed.storageMode === "zero_knowledge" ? redeemed.encryptedItemKey : null,
      redeemed.storageMode === "zero_knowledge" ? redeemed.ciphertext : null,
      redeemed.storageMode === "server_managed" ? redeemed.payload : null,
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
      "abadge run requires the local daemon.\n" +
        "hint: Start it with: abadge daemon start && abadge profile unlock",
      { cause: err },
    );
  }
}

/**
 * Profile-wide bulk variant of {@link runWithUseRedeem}. Mints one mount
 * handle per item via `access.use`, redeems them concurrently, then asks the
 * daemon to spawn the subprocess with every secret injected.
 */
export async function runWithUseRedeemBulk(
  client: AbadgeAgentClient,
  profileId: string,
  executable: string,
  args: string[],
): Promise<never> {
  const result = await client.access.use({ profileId }, { delivery: "env" });
  if ("mountId" in result) {
    throw new AbadgeApiError(
      500,
      "INTEGRITY_ERROR",
      "access.use returned an item-shaped response for a profile target",
      "This indicates a server/client version skew; report a bug.",
    );
  }
  if (result.items.length === 0) {
    // Nothing to inject — spawn the bare command with the parent env (the
    // expected behavior for a profile with no mountable items).
    const proc = Bun.spawn([executable, ...args], {
      env: process.env as Record<string, string>,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    });
    const exitCode = await proc.exited;
    process.exit(exitCode);
  }

  // Redeem every handle in parallel. Any redemption failure rejects the whole
  // call — same all-or-nothing semantics as the legacy bulk path. Successfully
  // redeemed-but-then-failed handles remain consumed in the DB, which is the
  // correct audit behavior (a redeemed row records "allowed").
  const redeemed = await Promise.all(
    result.items.map((handle) => client.access.redeemMount(handle.mountId)),
  );

  try {
    const execItems: BulkExecItem[] = redeemed.map((r) => {
      if (r.storageMode === "zero_knowledge") {
        return {
          itemId: r.itemId,
          label: r.label,
          storageMode: "zero_knowledge" as const,
          encryptedItemKey: r.encryptedItemKey,
          ciphertext: r.ciphertext,
          profileId: r.profileId,
          contentVersion: r.contentVersion,
        };
      }
      return {
        itemId: r.itemId,
        label: r.label,
        storageMode: "server_managed" as const,
        payload: r.payload,
      };
    });
    const res = await daemonExpandEnvBulk(execItems, executable, args);
    process.exit(res.exitCode);
  } catch (err) {
    if (err instanceof AbadgeApiError) {
      throw err;
    }
    throw new Error(
      "abadge run --all requires the local daemon.\n" +
        "hint: Start it with: abadge daemon start && abadge profile unlock",
      { cause: err },
    );
  }
}

/** Which flags the user explicitly provided, used for mutual-exclusion checks. */
export type RunFlagsProvided = {
  all: boolean;
  item: boolean;
  field: boolean;
  envVar: boolean;
  expandEnv: boolean;
};

/**
 * Validate the combination of `run` flags. `--field` and `--env-var` only apply
 * in single-item mode; `--all` (bulk) and `--expand-env` each take over field
 * selection, so combining them with the single-item flags is a silent no-op we
 * reject up front. Returns an error message when the combination is invalid,
 * otherwise `null`.
 */
export function validateRunFlags(flags: RunFlagsProvided): string | null {
  if (flags.all && flags.item) {
    return "--all and --item are mutually exclusive. Pick one.";
  }
  if (!flags.all && !flags.item) {
    return "Specify --item <id> for single-secret mode or --all for bulk-inject mode.\nhint: --all bulk-injects every item in the active profile that the agent has mount_env on.";
  }
  if (flags.all && (flags.field || flags.envVar || flags.expandEnv)) {
    return "--field, --env-var, and --expand-env apply to single-item mode only and cannot be combined with --all.";
  }
  if (flags.expandEnv && (flags.field || flags.envVar)) {
    return "--field and --env-var cannot be combined with --expand-env (which injects every field as its own env var).";
  }
  return null;
}

export function createRunCommand(): Command {
  const cmd = new Command("run")
    .description("Run a command with one or more secrets injected as environment variables")
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
    .option(
      "--env-var <name>",
      "Environment variable name for the secret (single-item mode)",
      "ABADGE_SECRET",
    )
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

        // `--env-var` carries a default, so its mere presence in `opts` does not
        // mean the user passed it — ask Commander whether the value came from
        // the CLI.
        const flagError = validateRunFlags({
          all: Boolean(opts.all),
          item: opts.item !== undefined,
          field: opts.field !== undefined,
          envVar: cmd.getOptionValueSource("envVar") === "cli",
          expandEnv: Boolean(opts.expandEnv),
        });
        if (flagError) {
          error(flagError);
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
            await runWithUseRedeemBulk(client, profileId, executable, command.slice(1));
          } else if (opts.expandEnv) {
            await runWithUseRedeem(client, opts.item as string, executable, command.slice(1));
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
