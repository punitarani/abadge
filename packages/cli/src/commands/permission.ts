import { CANONICAL_CAPABILITIES, CAPABILITIES, type Capability } from "@abadge/core";
import type { CreatePermissionInput } from "@abadge/sdk";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { error, errorMessage, json, success, table } from "../output";

const CANONICAL = CANONICAL_CAPABILITIES as readonly string[];

/** Parse, validate, and de-duplicate the repeated/comma-separated `--capability` flags. */
function parseCapabilities(rawFlags: string[]): Capability[] {
  const raw = rawFlags
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);

  if (raw.length === 0) {
    error("--capability is required (repeat the flag or pass a comma-separated list)");
    process.exit(1);
  }

  const invalid = raw.filter((c) => !CAPABILITIES.includes(c as Capability));
  if (invalid.length > 0) {
    error(
      `Unknown capability ${invalid.length > 1 ? "values" : "value"}: ${invalid.join(", ")}. Must be one of: ${CAPABILITIES.join(", ")}`,
    );
    process.exit(1);
  }

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const capabilities: Capability[] = [];
  for (const c of raw) {
    if (seen.has(c)) {
      duplicates.push(c);
      continue;
    }
    seen.add(c);
    capabilities.push(c as Capability);
  }
  if (duplicates.length > 0) {
    error(
      `Duplicate capabilities: ${duplicates.join(", ")}. Each capability may only appear once.`,
    );
    process.exit(1);
  }
  return capabilities;
}

/**
 * Resolve the grant target from `--item-id` / `--profile-id`, enforcing exactly
 * one and rejecting canonical capabilities on item targets (with the actionable
 * fix) instead of a confusing server round-trip. Exits the process on error.
 */
function resolveGrantTarget(
  opts: { itemId?: string; profileId?: string },
  capabilities: Capability[],
): { itemId: string } | { profileId: string } {
  if (Boolean(opts.itemId) === Boolean(opts.profileId)) {
    error(
      "Pass exactly one of --item-id or --profile-id. Item grants use legacy capability names; profile grants use canonical read/use.",
    );
    process.exit(1);
  }

  if (opts.itemId) {
    const canonicalGiven = capabilities.filter((c) => CANONICAL.includes(c));
    if (canonicalGiven.length > 0) {
      error(
        `Item grants don't accept canonical ${canonicalGiven.join(", ")}. ` +
          "Either pass --profile-id <id> to grant canonical read/use across a profile, " +
          "or use a legacy item capability: read_ciphertext, reveal_plaintext, mount_env, mount_file.",
      );
      process.exit(1);
    }
    return { itemId: opts.itemId };
  }
  return { profileId: opts.profileId as string };
}

export function createPermissionCommand(): Command {
  const cmd = new Command("permission").description("Grant, list, and revoke agent access grants");

  cmd
    .command("create")
    .description(
      "Grant one or more capabilities to an agent on a single item (--item-id) or a whole profile (--profile-id), atomic per batch",
    )
    .requiredOption("--agent-id <id>", "Agent ID")
    .option("--item-id <id>", "Item ID — grant on one item (uses legacy capability names)")
    .option(
      "--profile-id <id>",
      "Profile ID — grant on every item in a profile (uses canonical read/use)",
    )
    .requiredOption(
      "--capability <cap>",
      "Capability. With --profile-id: canonical `read` or `use`. With --item-id: a legacy name (read_ciphertext, reveal_plaintext, mount_env, mount_file). Repeat the flag or comma-separate to grant several.",
      (value: string, previous: string[]) => previous.concat([value]),
      [] as string[],
    )
    .option("--expires-at <timestamp>", "ISO 8601 expiry applied to every granted capability")
    .option("--json", "Output as JSON")
    .action(
      async (opts: {
        agentId: string;
        itemId?: string;
        profileId?: string;
        capability: string[];
        expiresAt?: string;
        json?: boolean;
      }) => {
        const capabilities = parseCapabilities(opts.capability);
        const target = resolveGrantTarget(opts, capabilities);

        try {
          const client = await createUserApiClient();
          // Length is guarded in parseCapabilities; cast narrows to the
          // non-empty tuple shape demanded by CreatePermissionSchema.
          const result = await client.permissions.create({
            agentId: opts.agentId,
            ...target,
            capabilities: capabilities as [Capability, ...Capability[]],
            expiresAt: opts.expiresAt,
          } satisfies CreatePermissionInput);

          if (opts.json) {
            json(result);
          } else {
            for (const p of result.permissions) {
              success(`Permission ${p.id} created (${p.capability}).`);
            }
            success(
              `Granted ${result.permissions.length} permission${result.permissions.length === 1 ? "" : "s"}.`,
            );
          }
        } catch (err) {
          error(errorMessage(err, "Failed to create permission."));
          process.exit(1);
        }
      },
    );

  cmd
    .command("list")
    .description("List all permissions")
    .option("--agent-id <id>", "Filter by agent")
    .option("--item-id <id>", "Filter by item")
    .option("--json", "Output as JSON")
    .action(async (opts: { agentId?: string; itemId?: string; json?: boolean }) => {
      try {
        const client = await createUserApiClient();
        const permissions = (
          await client.permissions.list({
            agentId: opts.agentId,
            itemId: opts.itemId,
          })
        ).permissions;

        if (opts.json) {
          json(permissions);
          return;
        }

        table(
          permissions.map((permission) => ({
            ID: permission.id,
            Agent: permission.agentId,
            Target: permission.itemId ?? `profile:${permission.profileId ?? "?"}`,
            Capability: permission.capability,
            Expires: permission.expiresAt ?? "-",
            Created: permission.createdAt,
          })),
        );
      } catch (err) {
        error(errorMessage(err, "Failed to list permissions."));
        process.exit(1);
      }
    });

  cmd
    .command("revoke")
    .description("Revoke a permission")
    .argument("<id>", "Permission ID")
    .action(async (id: string) => {
      try {
        const client = await createUserApiClient();
        await client.permissions.delete(id);
        success(`Permission ${id} revoked.`);
      } catch (err) {
        error(errorMessage(err, "Failed to revoke permission."));
        process.exit(1);
      }
    });

  return cmd;
}
