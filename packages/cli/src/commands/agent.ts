import { AGENT_KINDS, type AgentKind } from "@abadge/core";
import { Command } from "commander";
import { createSessionApiClient } from "../client";
import { error, errorMessage, json, success, table, warn } from "../output";

export function createAgentCommand(): Command {
  const cmd = new Command("agent").description("Manage agents");

  cmd
    .command("register")
    .description("Register a new agent")
    .requiredOption("-n, --name <name>", "Agent name")
    .option("-k, --kind <kind>", "Agent kind", "remote_agent")
    .option("-d, --description <text>", "Agent description")
    .option("--json", "Output as JSON")
    .action(async (opts: { name: string; kind: string; description?: string; json?: boolean }) => {
      if (!AGENT_KINDS.includes(opts.kind as AgentKind)) {
        error(`--kind must be one of: ${AGENT_KINDS.join(", ")}`);
        process.exit(1);
      }
      const kind = opts.kind as AgentKind;

      try {
        const client = await createSessionApiClient();
        const result = await client.createAgent({
          name: opts.name,
          kind,
          metadata: opts.description ? { description: opts.description } : {},
        });

        if (opts.json) {
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
    });

  cmd
    .command("list")
    .description("List all agents")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const client = await createSessionApiClient();
        const agents = (await client.listAgents()).agents;

        if (opts.json) {
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
    });

  cmd
    .command("rotate")
    .description("Rotate an agent API key")
    .argument("<id>", "Agent ID")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const client = await createSessionApiClient();
        const result = await client.rotateAgent(id);

        if (opts.json) {
          json({ apiKey: result.apiKey, keyPrefix: result.keyPrefix });
        } else {
          success(`Agent ${id} key rotated.`);
          console.log("");
          warn("Save this API key — it will NOT be shown again:");
          console.log(`  ${result.apiKey}`);
        }
      } catch (err) {
        error(errorMessage(err, "Failed to rotate agent key."));
        process.exit(1);
      }
    });

  cmd
    .command("revoke")
    .description("Revoke an agent")
    .argument("<id>", "Agent ID")
    .action(async (id: string) => {
      try {
        const client = await createSessionApiClient();
        await client.revokeAgent(id);
        success(`Agent ${id} revoked.`);
      } catch (err) {
        error(errorMessage(err, "Failed to revoke agent."));
        process.exit(1);
      }
    });

  return cmd;
}
