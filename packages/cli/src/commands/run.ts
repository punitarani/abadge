import type { BulkMountEnvItem, RedeemMountResponse } from "@abadge/core";
import type { BulkExecItem } from "@abadge/daemon";
import { type AbadgeAgentClient, AbadgeApiError } from "@abadge/sdk";
import { Command } from "commander";
import { createAgentApiClient } from "../client";
import { loadConfig } from "../config";
import { daemonExpandEnv, daemonExpandEnvBulk } from "../daemon";
import { error, errorMessage } from "../output";
import { resolveSecretValue } from "../secret";

/**
 * §RM-PR4 — Run an item via the unified `access.use` → `redeemMount` →
 * daemon path. Mirrors {@link runWithExpandEnv} (which uses the legacy
 * `accessMount`); kept side-by-side until the legacy method is removed in v0.6.
 */
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
        "hint: Start it with: abadge daemon start && abadge vault unlock",
      { cause: err },
    );
  }
}

/**
 * §RM-PR4 — Profile-wide bulk variant of {@link runWithUseRedeem}. Mints one
 * mount handle per item via `access.useProfile`, redeems them concurrently,
 * then asks the daemon to spawn the subprocess with every secret injected.
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
    // Nothing to inject — spawn the bare command with the parent env. This
    // matches the legacy bulkAccessMountEnv path's behavior on an empty profile.
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
        "hint: Start it with: abadge daemon start && abadge vault unlock",
      { cause: err },
    );
  }
}

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
            // §RM-PR4 — route the bulk path through `access.useProfile` +
            // `redeemMount` so every mint is recorded in `mount_reservations`
            // and audited as `via=mount_redeem`. The legacy
            // `runWithAll`/`bulkAccessMountEnv` path stays for one release
            // (callers exercising it directly via the SDK).
            await runWithUseRedeemBulk(client, profileId, executable, command.slice(1));
          } else if (opts.expandEnv) {
            // §RM-PR4 — same flip as --all, but for the single-item field-
            // expansion mode. The legacy `runWithExpandEnv`/`accessMount`
            // path remains importable from this module for one release.
            // opts.item is guaranteed by the mutex check above.
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
