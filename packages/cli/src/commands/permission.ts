import { CAPABILITIES, type Capability } from "@abadge/core";
import { Command } from "commander";
import { clearOperatorSessionIfExpired, createOperatorClient } from "../client";
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

        try {
          const client = await createOperatorClient();
          const result = await client.createPermission({
            agentId: opts.agentId,
            itemId: opts.itemId,
            capability: opts.capability as Capability,
          });

          if (opts.json) {
            json(result);
            return;
          }

          success("Permission created.");
        } catch (err) {
          await clearOperatorSessionIfExpired(err);
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
      try {
        const client = await createOperatorClient();
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
        await clearOperatorSessionIfExpired(err);
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
        const client = await createOperatorClient();
        await client.revokePermission(id);
        success(`Permission ${id} revoked.`);
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
        error(errorMessage(err, "Failed to revoke permission."));
        process.exit(1);
      }
    });

  return cmd;
}
