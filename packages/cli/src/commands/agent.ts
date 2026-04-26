import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { AGENT_KINDS, type AgentKind } from "@abadge/core";
import type { AbadgeUserClient } from "@abadge/sdk";
import { Command } from "commander";
import { createUserApiClient } from "../client";
import { loadConfig, updateConfig } from "../config";
import { error, errorMessage, json, success, table, warn } from "../output";

type McpConfigSnippetInput = {
  agentId: string;
  apiUrl: string;
  privateKeyPath: string;
  binaryPath: string;
};

export type McpConfigObject = {
  mcpServers: {
    abadge: {
      command: string;
      env: {
        ABADGE_API_URL: string;
        ABADGE_AGENT_ID: string;
        ABADGE_PRIVATE_KEY_PATH: string;
      };
    };
  };
};

export function buildMcpConfigObject(input: McpConfigSnippetInput): McpConfigObject {
  return {
    mcpServers: {
      abadge: {
        command: input.binaryPath,
        env: {
          ABADGE_API_URL: input.apiUrl,
          ABADGE_AGENT_ID: input.agentId,
          ABADGE_PRIVATE_KEY_PATH: input.privateKeyPath,
        },
      },
    },
  };
}

export function buildMcpConfigSnippet(input: McpConfigSnippetInput): string {
  return JSON.stringify(buildMcpConfigObject(input), null, 2);
}

export function defaultMcpBinaryPath(): string {
  // Default to the directory install.sh writes to. Operators with a custom
  // ABADGE_INSTALL_DIR can read their installed location from the env at
  // register time.
  const installDir = process.env.ABADGE_INSTALL_DIR ?? join(homedir(), ".abadge", "bin");
  return join(installDir, "abadge-mcp");
}

/**
 * Maps an agent kind to the local config slot that should persist its
 * credentials. Remote agents don't run on the user's machine and must not
 * overwrite any local slot — return `null` so the register handler skips
 * persistence entirely.
 */
export function configSlotForKind(kind: AgentKind): "cli" | "mcp" | null {
  switch (kind) {
    case "local_cli":
      return "cli";
    case "local_mcp":
      return "mcp";
    case "remote":
      return null;
    default: {
      // Compile-time exhaustiveness check — a new AGENT_KINDS variant will
      // fail to typecheck here until this switch is updated.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

async function registerKeypairAgent(
  client: AbadgeUserClient,
  opts: {
    name: string;
    kind: AgentKind;
    description?: string;
    json?: boolean;
    mcpConfig?: boolean;
  },
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

  const configSlot = configSlotForKind(opts.kind);
  if (configSlot) {
    updateConfig({
      localAgents: {
        ...loadConfig()?.localAgents,
        [configSlot]: { agentId: result.agent.id, privateKeyPath: keyPath },
      },
    });
  }

  // The action handler validates that loadConfig()?.apiUrl is set BEFORE
  // calling registerKeypairAgent when --mcp-config is requested, so the
  // ?? "" fallback below is defensive only — it should never resolve to "".
  const mcpConfig = opts.mcpConfig
    ? buildMcpConfigObject({
        agentId: result.agent.id,
        apiUrl: loadConfig()?.apiUrl ?? "",
        privateKeyPath: keyPath,
        binaryPath: defaultMcpBinaryPath(),
      })
    : undefined;

  if (opts.json) {
    json({
      agent: result.agent,
      privateKeyPath: keyPath,
      ...(mcpConfig ? { mcpConfig } : {}),
    });
  } else {
    success(`Agent "${result.agent.name}" registered (id: ${result.agent.id}).`);
    success(`Private key saved to ${keyPath}`);
    if (!configSlot) {
      warn(
        "Remote agent registered. Configure the remote service with the credentials shown above; no local config was written.",
      );
    }
    if (mcpConfig) {
      console.log("");
      console.log("Add to your MCP client config (e.g. Claude Desktop):");
      console.log(JSON.stringify(mcpConfig, null, 2));
    }
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
    .option(
      "--mcp-config",
      "After registering a local_mcp agent, print a Claude Desktop config snippet",
    )
    .option("--json", "Output as JSON")
    .action(
      async (opts: {
        name: string;
        kind: string;
        description?: string;
        legacyApiKey?: boolean;
        mcpConfig?: boolean;
        json?: boolean;
      }) => {
        if (!AGENT_KINDS.includes(opts.kind as AgentKind)) {
          error(`--kind must be one of: ${AGENT_KINDS.join(", ")}`);
          process.exit(1);
        }
        const kind = opts.kind as AgentKind;

        if (opts.mcpConfig && kind !== "local_mcp") {
          error("--mcp-config is only valid with --kind local_mcp.");
          process.exit(1);
        }
        if (opts.mcpConfig && opts.legacyApiKey) {
          error("--mcp-config cannot be combined with --legacy-api-key.");
          process.exit(1);
        }
        if (opts.mcpConfig && !loadConfig()?.apiUrl) {
          // Validate before createAgent so a missing apiUrl doesn't strand a
          // server-side agent record with no usable client config.
          error("Could not resolve ABADGE_API_URL from local config; run `abadge login` first.");
          process.exit(1);
        }

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
    .command("mcp-config")
    .description("Print a Claude Desktop config snippet for a registered local_mcp agent")
    .argument(
      "<id>",
      "Agent ID (must match the registered local_mcp agent in ~/.abadge/config.json)",
    )
    .action((id: string) => {
      const config = loadConfig();
      const apiUrl = config?.apiUrl;
      const localMcp = config?.localAgents?.mcp;

      if (!apiUrl) {
        error("Could not resolve ABADGE_API_URL from local config; run `abadge login` first.");
        process.exit(1);
      }
      if (!localMcp) {
        error(
          "No local_mcp agent is registered on this machine. Run `abadge agent register --kind local_mcp --mcp-config` first.",
        );
        process.exit(1);
      }
      if (localMcp.agentId !== id) {
        error(
          `Local config has agent ${localMcp.agentId}, not ${id}. Re-register the agent or pass the matching id.`,
        );
        process.exit(1);
      }

      const snippet = buildMcpConfigSnippet({
        agentId: localMcp.agentId,
        apiUrl,
        privateKeyPath: localMcp.privateKeyPath,
        binaryPath: defaultMcpBinaryPath(),
      });
      console.log(snippet);
    });

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
