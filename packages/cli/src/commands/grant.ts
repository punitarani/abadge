import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, str, success, table } from "../output";

export async function grantCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "create":
      return grantCreate(args.slice(1));
    case "list":
      return grantList(args.slice(1));
    case "revoke":
      return grantRevoke(args.slice(1));
    default:
      console.log("Usage: abadge grant <create|list|revoke>");
      process.exit(sub ? 1 : 0);
  }
}

async function grantCreate(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      "principal-id": { type: "string" },
      "item-id": { type: "string" },
      capability: { type: "string" },
      json: { type: "boolean" },
    },
    strict: false,
  });

  const principalId = str(values["principal-id"]);
  const itemId = str(values["item-id"]);
  const capability = str(values.capability) ?? "env_inject";

  if (!principalId || !itemId) {
    error("--principal-id and --item-id are required.");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const result = await client.post("/v1/grants", {
      agentId: principalId,
      credentialId: itemId,
      allowedDeliveryModes: [capability],
    });

    if (values.json) {
      json(result);
    } else {
      success("Grant created.");
    }
  } catch (err) {
    error(errorMessage(err, "Failed to create grant."));
    process.exit(1);
  }
}

async function grantList(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: false });
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const grants =
      await client.get<
        {
          agentId: string;
          credentialId: string;
          allowedDeliveryModes: string[];
          grantedAt: string;
        }[]
      >("/v1/grants");

    if (values.json) {
      json(grants);
      return;
    }

    table(
      grants.map((g) => ({
        Principal: g.agentId,
        Item: g.credentialId,
        Modes: (g.allowedDeliveryModes ?? []).join(", "),
        Granted: g.grantedAt,
      })),
    );
  } catch (err) {
    error(errorMessage(err, "Failed to list grants."));
    process.exit(1);
  }
}

async function grantRevoke(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    error("Usage: abadge grant revoke <id>");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    await client.delete(`/v1/grants/${id}`);
    success(`Grant ${id} revoked.`);
  } catch (err) {
    error(errorMessage(err, "Failed to revoke grant."));
    process.exit(1);
  }
}
