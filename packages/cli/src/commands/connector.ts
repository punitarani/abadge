import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, success } from "../output";

export async function connectorCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "add":
      return connectorAdd(rest);
    default:
      error(`Unknown subcommand: ${sub ?? "(none)"}. Use: add`);
      process.exit(1);
  }
}

async function connectorAdd(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string" },
      type: { type: "string" },
      json: { type: "boolean", default: false },
    },
    strict: false,
  });

  if (!values.name || !values.type) {
    error("--name and --type are required.");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const result = await client.post("/v1/connectors", {
      name: values.name,
      type: values.type,
    });
    if (values.json) {
      json(result);
    } else {
      success(`Connector "${values.name}" added.`);
    }
  } catch (err) {
    error(errorMessage(err, "Failed to add connector."));
    process.exit(1);
  }
}
