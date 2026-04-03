import { CAPABILITIES, type Capability } from "@abadge/core";
import { Command } from "commander";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, success, table } from "../output";

export function createPermissionCommand(): Command {
  const cmd = new Command("permission").description("Manage access permissions");

  cmd
    .command("create")
    .description("Create a new permission")
    .requiredOption("--agent-id <id>", "Agent ID")
    .requiredOption("--item-id <id>", "Item ID")
    .option("--capability <cap>", "Capability", "mount_env")
    .option("--json", "Output as JSON")
    .action(
      async (opts: { agentId: string; itemId: string; capability: string; json?: boolean }) => {
        if (!CAPABILITIES.includes(opts.capability as Capability)) {
          error(`--capability must be one of: ${CAPABILITIES.join(", ")}`);
          process.exit(1);
        }
        const capability = opts.capability as Capability;

        const config = requireConfig();
        const client = new ApiClient(config);

        try {
          const result = await client.createPermission({
            agentId: opts.agentId,
            itemId: opts.itemId,
            capability,
          });

          if (opts.json) {
            json(result);
          } else {
            success("Permission created.");
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
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const config = requireConfig();
      const client = new ApiClient(config);

      try {
        const permissions = (await client.listPermissions()).permissions;

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
      const config = requireConfig();
      const client = new ApiClient(config);

      try {
        await client.revokePermission(id);
        success(`Permission ${id} revoked.`);
      } catch (err) {
        error(errorMessage(err, "Failed to revoke permission."));
        process.exit(1);
      }
    });

  return cmd;
}
