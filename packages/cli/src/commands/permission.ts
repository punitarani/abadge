import { parseArgs } from "node:util";
import { CAPABILITIES, type Capability } from "@abadge/core";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, str, success, table } from "../output";

export async function permissionCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "create":
      return permissionCreate(args.slice(1));
    case "list":
      return permissionList(args.slice(1));
    case "revoke":
      return permissionRevoke(args.slice(1));
    default:
      console.log("Usage: abadge permission <create|list|revoke>");
      process.exit(sub ? 1 : 0);
  }
}

async function permissionCreate(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      "agent-id": { type: "string" },
      "item-id": { type: "string" },
      capability: { type: "string" },
      json: { type: "boolean" },
    },
    strict: false,
  });

  const agentId = str(values["agent-id"]);
  const itemId = str(values["item-id"]);
  const capability = (str(values.capability) ?? "mount_env") as Capability;

  if (!agentId || !itemId) {
    error("--agent-id and --item-id are required.");
    process.exit(1);
  }

  if (!CAPABILITIES.includes(capability)) {
    error(`--capability must be one of: ${CAPABILITIES.join(", ")}`);
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const result = await client.createPermission({
      agentId,
      itemId,
      capability,
    });

    if (values.json) {
      json(result);
    } else {
      success("Permission created.");
    }
  } catch (err) {
    error(errorMessage(err, "Failed to create permission."));
    process.exit(1);
  }
}

async function permissionList(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: false });
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const permissions = (await client.listPermissions()).permissions;

    if (values.json) {
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
}

async function permissionRevoke(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    error("Usage: abadge permission revoke <id>");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    await client.revokePermission(id);
    success(`Permission ${id} revoked.`);
  } catch (err) {
    error(errorMessage(err, "Failed to revoke permission."));
    process.exit(1);
  }
}
