import { parseArgs } from "node:util";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, str, success, table, warn } from "../output";

export async function principalCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "register":
      return principalRegister(args.slice(1));
    case "list":
      return principalList(args.slice(1));
    case "revoke":
      return principalRevoke(args.slice(1));
    default:
      console.log("Usage: abadge principal <register|list|revoke>");
      process.exit(sub ? 1 : 0);
  }
}

async function principalRegister(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string", short: "n" },
      description: { type: "string", short: "d" },
      json: { type: "boolean" },
    },
    strict: false,
  });

  const name = str(values.name);
  if (!name) {
    error("--name is required.");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const result = await client.post<{ agent: { id: string; name: string }; apiKey: string }>(
      "/v1/principals",
      {
        name,
        description: str(values.description),
      },
    );

    if (values.json) {
      json(result);
    } else {
      success(`Principal "${result.agent.name}" registered (id: ${result.agent.id}).`);
      console.log("");
      warn("Save this API key — it will NOT be shown again:");
      console.log(`  ${result.apiKey}`);
    }
  } catch (err) {
    error(errorMessage(err, "Failed to register principal."));
    process.exit(1);
  }
}

async function principalList(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: false });
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const principals =
      await client.get<{ id: string; name: string; enabled: boolean; createdAt: string }[]>(
        "/v1/principals",
      );

    if (values.json) {
      json(principals);
      return;
    }

    table(
      principals.map((p) => ({
        ID: p.id,
        Name: p.name,
        Enabled: String(p.enabled),
        Created: p.createdAt,
      })),
    );
  } catch (err) {
    error(errorMessage(err, "Failed to list principals."));
    process.exit(1);
  }
}

async function principalRevoke(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    error("Usage: abadge principal revoke <id>");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    await client.post(`/v1/principals/${id}/revoke`);
    success(`Principal ${id} revoked.`);
  } catch (err) {
    error(errorMessage(err, "Failed to revoke principal."));
    process.exit(1);
  }
}
