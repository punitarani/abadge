import { CAPABILITIES, type Capability } from "@abadge/core";
import type { CreatePermissionInput } from "@abadge/sdk";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { error, errorMessage, json, success, table } from "../output";

export function createPermissionCommand(): Command {
  const cmd = new Command("permission").description("Manage access permissions");

  cmd
    .command("create")
    .description("Create a new permission")
    .requiredOption("--agent-id <id>", "Agent ID")
    .requiredOption("--item-id <id>", "Item ID")
    .requiredOption("--capability <cap>", "Capability")
    .option("--expires-at <timestamp>", "Optional ISO timestamp expiry")
    .option("--json", "Output as JSON")
    .action(
      async (opts: {
        agentId: string;
        itemId: string;
        capability: string;
        expiresAt?: string;
        json?: boolean;
      }) => {
        if (!CAPABILITIES.includes(opts.capability as Capability)) {
          error(`--capability must be one of: ${CAPABILITIES.join(", ")}`);
          process.exit(1);
        }
        const capability = opts.capability as Capability;

        try {
          const client = await createUserApiClient();
          const result = await client.createPermission({
            agentId: opts.agentId,
            itemId: opts.itemId,
            capability,
            expiresAt: opts.expiresAt,
          } satisfies CreatePermissionInput);

          if (opts.json) {
            json(result);
          } else {
            success(`Permission ${result.permission.id} created.`);
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
          await client.listPermissions({
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
            Item: permission.itemId,
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
        await client.revokePermission(id);
        success(`Permission ${id} revoked.`);
      } catch (err) {
        error(errorMessage(err, "Failed to revoke permission."));
        process.exit(1);
      }
    });

  return cmd;
}
