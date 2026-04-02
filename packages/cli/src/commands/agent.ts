import { parseArgs } from "node:util";
import { AGENT_KINDS, type AgentKind } from "@abadge/core";
import { ApiClient } from "../client";
import { requireConfig } from "../config";
import { error, errorMessage, json, str, success, table, warn } from "../output";

export async function agentCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "register":
      return agentRegister(args.slice(1));
    case "list":
      return agentList(args.slice(1));
    case "revoke":
      return agentRevoke(args.slice(1));
    default:
      console.log("Usage: abadge agent <register|list|revoke>");
      process.exit(sub ? 1 : 0);
  }
}

async function agentRegister(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: "string", short: "n" },
      kind: { type: "string", short: "k" },
      description: { type: "string", short: "d" },
      json: { type: "boolean" },
    },
    strict: false,
  });

  const name = str(values.name);
  const kind = (str(values.kind) ?? "remote_agent") as AgentKind;
  if (!name) {
    error("--name is required.");
    process.exit(1);
  }

  if (!AGENT_KINDS.includes(kind)) {
    error(`--kind must be one of: ${AGENT_KINDS.join(", ")}`);
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const result = await client.createAgent({
      name,
      kind,
      metadata: str(values.description) ? { description: str(values.description) } : {},
    });

    if (values.json) {
      json(result);
    } else {
      success(`Agent "${result.agent.name}" registered (id: ${result.agent.id}).`);
      console.log("");
      warn("Save this API key — it will NOT be shown again:");
      console.log(`  ${result.apiKey}`);
    }
  } catch (err) {
    error(errorMessage(err, "Failed to register agent."));
    process.exit(1);
  }
}

async function agentList(args: string[]): Promise<void> {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } }, strict: false });
  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    const agents = (await client.listAgents()).agents;

    if (values.json) {
      json(agents);
      return;
    }

    table(
      agents.map((agent) => ({
        ID: agent.id,
        Name: agent.name,
        Kind: agent.kind,
        Locality: agent.locality,
        Enabled: String(agent.enabled && agent.revokedAt === null),
        Created: agent.createdAt,
      })),
    );
  } catch (err) {
    error(errorMessage(err, "Failed to list agents."));
    process.exit(1);
  }
}

async function agentRevoke(args: string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    error("Usage: abadge agent revoke <id>");
    process.exit(1);
  }

  const config = requireConfig();
  const client = new ApiClient(config);

  try {
    await client.revokeAgent(id);
    success(`Agent ${id} revoked.`);
  } catch (err) {
    error(errorMessage(err, "Failed to revoke agent."));
    process.exit(1);
  }
}
