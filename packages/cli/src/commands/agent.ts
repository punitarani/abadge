import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { AGENT_KINDS, type AgentKind } from "@abadge/core";
import { generateEd25519KeyPair } from "@abadge/crypto/shared";
import type { AgentRegistrationResult } from "@abadge/sdk";
import { Command } from "commander";
import { ApiClient, clearOperatorSessionIfExpired, createOperatorClient } from "../client";
import { DEFAULT_API_URL, loadConfig, requireConfig } from "../config";
import { error, errorMessage, json, success, table, warn } from "../output";

function printRegistrationResult(result: AgentRegistrationResult): void {
  success(`Agent "${result.agent.name}" registered (id: ${result.agent.id}).`);

  if (result.apiKey) {
    console.log("");
    warn("Save this API key — it will NOT be shown again:");
    console.log(`  ${result.apiKey}`);
  }

  if (result.bootstrapToken) {
    console.log("");
    warn("Save this bootstrap token — it can be used only once to enroll the agent:");
    console.log(`  ${result.bootstrapToken}`);
    if (result.bootstrapExpiresAt) {
      console.log(`  expires at ${result.bootstrapExpiresAt}`);
    }
  }
}

export function createAgentCommand(): Command {
  const cmd = new Command("agent").description("Manage agents");

  cmd
    .command("register")
    .description("Register a new agent")
    .requiredOption("-n, --name <name>", "Agent name")
    .option("-k, --kind <kind>", "Agent kind", "remote_agent")
    .option("-d, --description <text>", "Agent description")
    .option("--legacy-api-key", "Create a legacy API-key agent")
    .option("--no-bootstrap-token", "Do not issue a bootstrap token for enrollment")
    .option("--json", "Output as JSON")
    .action(
      async (opts: {
        name: string;
        kind: string;
        description?: string;
        legacyApiKey?: boolean;
        bootstrapToken?: boolean;
        json?: boolean;
      }) => {
        if (!AGENT_KINDS.includes(opts.kind as AgentKind)) {
          error(`--kind must be one of: ${AGENT_KINDS.join(", ")}`);
          process.exit(1);
        }

        try {
          const client = await createOperatorClient(requireConfig());
          const result = await client.createAgent({
            name: opts.name,
            kind: opts.kind as AgentKind,
            authMethod: opts.legacyApiKey ? "legacy_api_key" : "public_key_session",
            issueBootstrapToken: opts.legacyApiKey ? false : opts.bootstrapToken !== false,
            metadata: opts.description ? { description: opts.description } : {},
          });

          if (opts.json) {
            json(result);
            return;
          }

          printRegistrationResult(result);
        } catch (err) {
          await clearOperatorSessionIfExpired(err);
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
        const client = await createOperatorClient(requireConfig());
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
            Auth: agent.authMethod,
            Locality: agent.locality,
            Enabled: String(agent.enabled && agent.revokedAt === null),
            Created: agent.createdAt,
          })),
        );
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
        error(errorMessage(err, "Failed to list agents."));
        process.exit(1);
      }
    });

  cmd
    .command("rotate")
    .description("Rotate a legacy agent API key")
    .argument("<id>", "Agent ID")
    .option("--json", "Output as JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const client = await createOperatorClient(requireConfig());
        const result = await client.rotateAgent(id);

        if (opts.json) {
          json({ apiKey: result.apiKey, keyPrefix: result.keyPrefix });
          return;
        }

        success(`Agent ${id} key rotated.`);
        console.log("");
        warn("Save this API key — it will NOT be shown again:");
        console.log(`  ${result.apiKey}`);
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
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
        const client = await createOperatorClient(requireConfig());
        await client.revokeAgent(id);
        success(`Agent ${id} revoked.`);
      } catch (err) {
        await clearOperatorSessionIfExpired(err);
        error(errorMessage(err, "Failed to revoke agent."));
        process.exit(1);
      }
    });

  cmd
    .command("enroll")
    .description("Enroll a keypair-backed agent with a one-time bootstrap token")
    .requiredOption("--bootstrap-token <token>", "Bootstrap token")
    .option("--api-url <url>", "API base URL")
    .option("--private-key-path <path>", "Where to store the generated private key")
    .option("--json", "Output as JSON")
    .action(
      async (opts: {
        bootstrapToken: string;
        apiUrl?: string;
        privateKeyPath?: string;
        json?: boolean;
      }) => {
        try {
          const apiUrl = opts.apiUrl ?? loadConfig()?.apiUrl ?? DEFAULT_API_URL;
          const privateKeyPath =
            opts.privateKeyPath ?? join(homedir(), ".abadge", "agents", `remote-${Date.now()}.jwk`);
          const { publicKey, privateKey } = await generateEd25519KeyPair();
          mkdirSync(dirname(privateKeyPath), { recursive: true, mode: 0o700 });
          writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
          chmodSync(privateKeyPath, 0o600);

          let result: Awaited<ReturnType<ApiClient["enrollAgent"]>>;
          try {
            const client = new ApiClient({ apiUrl });
            result = await client.enrollAgent({
              bootstrapToken: opts.bootstrapToken,
              publicKey,
            });
          } catch (error) {
            try {
              rmSync(privateKeyPath);
            } catch {
              // Best effort cleanup.
            }
            throw error;
          }

          if (opts.json) {
            json({
              ...result,
              privateKeyPath,
            });
            return;
          }

          success(`Agent "${result.agent.name}" enrolled.`);
          console.log(`Private key: ${privateKeyPath}`);
          console.log(`Agent ID: ${result.agent.id}`);
        } catch (err) {
          error(errorMessage(err, "Failed to enroll agent."));
          process.exit(1);
        }
      },
    );

  return cmd;
}
