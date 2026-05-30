import { CAPABILITIES, type Capability } from "@abadge/core";
import type { CreatePermissionInput } from "@abadge/sdk";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { error, errorMessage, json, success, table } from "../output";

export function createPermissionCommand(): Command {
  const cmd = new Command("permission").description("Grant, list, and revoke agent access grants");

  cmd
    .command("create")
    .description("Grant one or more capabilities to an agent on a single item (atomic per batch)")
    .requiredOption("--agent-id <id>", "Agent ID")
    .requiredOption("--item-id <id>", "Item ID")
    .requiredOption(
      "--capability <cap>",
      "Capability: read, use, or a legacy name (read_ciphertext, reveal_plaintext, mount_env, mount_file). Repeat the flag or comma-separate to grant several.",
      (value: string, previous: string[]) => previous.concat([value]),
      [] as string[],
    )
    .option("--expires-at <timestamp>", "ISO 8601 expiry applied to every granted capability")
    .option("--json", "Output as JSON")
    .action(
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: permission.grant parses comma-separated capabilities, validates each against the canonical+legacy set, branches on capability-matrix legality per locality+storage-mode, and surfaces detailed per-capability errors — splitting it would obscure the audit trail.
      async (opts: {
        agentId: string;
        itemId: string;
        capability: string[];
        expiresAt?: string;
        json?: boolean;
      }) => {
        const raw = opts.capability
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

        try {
          const client = await createUserApiClient();
          // Length is guarded above; cast narrows to the non-empty tuple
          // shape demanded by CreatePermissionSchema (Schema.NonEmptyArray).
          const result = await client.permissions.create({
            agentId: opts.agentId,
            itemId: opts.itemId,
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
