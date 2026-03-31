import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, str, success, table } from "../output";

interface Permission {
  id: string;
  agentId: string;
  credentialId: string;
  deliveryModes?: string[];
  policy?: string;
  createdAt: string;
}

export async function grantCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "create":
      return grantCreate(rest);
    case "list":
    case "ls":
      return grantList(rest);
    default:
      error(`Unknown subcommand: ${sub ?? "(none)"}. Use: create, list`);
      process.exit(1);
  }
}

async function grantCreate(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      agent: { type: "string" },
      credential: { type: "string" },
      "delivery-modes": { type: "string" },
      policy: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (!values.agent || !values.credential) {
    error("--agent and --credential are required.");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  const body: Record<string, unknown> = {
    agentId: values.agent,
    credentialId: values.credential,
  };
  const modes = str(values["delivery-modes"]);
  if (modes) body.deliveryModes = modes.split(",");
  if (values.policy) body.policy = values.policy;

  try {
    const result = await client.post<Permission>("/v1/permissions/grant", body);
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
  const { values } = parseArgs({
    args,
    options: {
      credential: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (!values.credential) {
    error("--credential is required.");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const permissions = await client.get<Permission[]>(
      `/v1/permissions/credential/${values.credential}`,
    );
    if (values.json) {
      json(permissions);
    } else {
      table(
        permissions.map((p) => ({
          ID: p.id,
          Agent: p.agentId,
          Modes: p.deliveryModes?.join(", ") ?? "-",
          Policy: p.policy ?? "-",
          Created: p.createdAt,
        })),
      );
    }
  } catch (err) {
    error(errorMessage(err, "Failed to list grants."));
    process.exit(1);
  }
}
