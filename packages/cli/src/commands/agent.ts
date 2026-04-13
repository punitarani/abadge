import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_KINDS, type AgentKind } from "@abadge/core";
import type { AbadgeUserClient } from "@abadge/sdk";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { loadConfig, updateConfig } from "../config";
import { error, errorMessage, json, success, table, warn } from "../output";

async function registerKeypairAgent(
  client: AbadgeUserClient,
  opts: { name: string; kind: AgentKind; description?: string; json?: boolean },
): Promise<void> {
  const genKey = crypto.subtle.generateKey.bind(crypto.subtle) as (
    algorithm: { name: string },
    extractable: boolean,
    keyUsages: string[],
  ) => Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;
  const keypair = await genKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keypair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keypair.privateKey);
  if (!publicKeyJwk.x) {
    error("Failed to export Ed25519 public key.");
    process.exit(1);
  }

  // Store the full JWK JSON string as publicKey — verifyEd25519 on the server
  // expects a JSON-serialized JWK, not the raw base64url x value.
  const publicKeySerialized = JSON.stringify(publicKeyJwk);

  const result = await client.createAgent({
    name: opts.name,
    kind: opts.kind,
    publicKey: publicKeySerialized,
    metadata: opts.description ? { description: opts.description } : {},
  });

  const agentsDir = join(homedir(), ".abadge", "agents");
  mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
  const keyPath = join(agentsDir, `${result.agent.id}.ed25519.jwk`);
  writeFileSync(keyPath, JSON.stringify(privateKeyJwk), { mode: 0o600 });

  const configSlot = opts.kind === "local_mcp" ? "mcp" : "cli";
  updateConfig({
    localAgents: {
      ...loadConfig()?.localAgents,
      [configSlot]: { agentId: result.agent.id, privateKeyPath: keyPath },
    },
  });

  if (opts.json) {
    json({ agent: result.agent, privateKeyPath: keyPath });
  } else {
    success(`Agent "${result.agent.name}" registered (id: ${result.agent.id}).`);
    success(`Private key saved to ${keyPath}`);
  }
}

async function registerLegacyAgent(
  client: AbadgeUserClient,
  opts: { name: string; kind: AgentKind; description?: string; json?: boolean },
): Promise<void> {
  const result = await client.createAgent({
    name: opts.name,
    kind: opts.kind,
    authMethod: "legacy_api_key",
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
}

export function createAgentCommand(): Command {
  const cmd = new Command("agent").description("Manage agents");

  cmd
    .command("register")
    .description("Register a new agent")
    .requiredOption("-n, --name <name>", "Agent name")
    .option("-k, --kind <kind>", "Agent kind", "local_cli")
    .option("-d, --description <text>", "Agent description")
    .option("--legacy-api-key", "Use legacy API key auth instead of Ed25519 keypair")
    .option("--json", "Output as JSON")
    .action(
      async (opts: {
        name: string;
        kind: string;
        description?: string;
        legacyApiKey?: boolean;
        json?: boolean;
      }) => {
        if (!AGENT_KINDS.includes(opts.kind as AgentKind)) {
          error(`--kind must be one of: ${AGENT_KINDS.join(", ")}`);
          process.exit(1);
        }
        const kind = opts.kind as AgentKind;

        try {
          const client = await createUserApiClient();
          if (opts.legacyApiKey) {
            await registerLegacyAgent(client, { ...opts, kind });
          } else {
            await registerKeypairAgent(client, { ...opts, kind });
          }
        } catch (err) {
          error(errorMessage(err, "Failed to register agent."));
          process.exit(1);
        }
      },
    );

  cmd
    .command("list")
    .description("List all agents")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const client = await createUserApiClient();
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
        const client = await createUserApiClient();
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
        const client = await createUserApiClient();
        await client.revokeAgent(id);
        success(`Agent ${id} revoked.`);
      } catch (err) {
        error(errorMessage(err, "Failed to revoke agent."));
        process.exit(1);
      }
    });

  return cmd;
}
