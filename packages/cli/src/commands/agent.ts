import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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

/**
 * Path where `agent add` writes a local agent's Ed25519 private key. Resolves
 * $HOME at call time (matching `registerKeypairAgent`) so tests can redirect to
 * a tmpdir.
 */
export function localAgentKeyPath(agentId: string): string {
  // biome-ignore lint/style/noRestrictedGlobals: cli helper resolves $HOME at call time so tests can redirect to a tmpdir
  return join(process.env.HOME ?? homedir(), ".abadge", "agents", `${agentId}.ed25519.jwk`);
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

export async function registerKeypairAgent(
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

  const result = await client.agents.create({
    name: opts.name,
    kind: opts.kind,
    publicKey: publicKeySerialized,
    metadata: opts.description ? { description: opts.description } : {},
  });

  // Resolve $HOME at call time (matches `cli/src/config.ts`) so unit tests
  // can redirect to a tmpdir.
  // biome-ignore lint/style/noRestrictedGlobals: cli helper resolves $HOME at call time so tests can redirect to a tmpdir
  const agentsDir = join(process.env.HOME ?? homedir(), ".abadge", "agents");
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

  if (opts.json) {
    // --mcp-config is rejected up-front in the action handler when --json is
    // also passed, so we never need to embed mcpConfig in the JSON payload.
    json({ agent: result.agent, privateKeyPath: keyPath });
    return;
  }

  success(`Agent "${result.agent.name}" registered (id: ${result.agent.id}).`);
  success(`Private key saved to ${keyPath}`);
  if (!configSlot) {
    warn(
      "Remote agent registered. Configure the remote service with the credentials shown above; no local config was written.",
    );
  }
  if (opts.mcpConfig) {
    // The action handler verifies loadConfig()?.apiUrl is non-empty before we
    // get here, so the ?? "" fallback is defensive only.
    const snippet = buildMcpConfigSnippet({
      agentId: result.agent.id,
      apiUrl: loadConfig()?.apiUrl ?? "",
      privateKeyPath: keyPath,
      binaryPath: defaultMcpBinaryPath(),
    });
    console.log("");
    console.log("Add to your MCP client config (e.g. Claude Desktop):");
    console.log(snippet);
  }
}

/**
 * Issue a one-time bootstrap token for an unenrolled public-key agent. The
 * client receiving the token completes enrollment by uploading its own
 * public key. The bootstrap token is shown once and never persisted in the
 * CLI config.
 */
export async function registerBootstrapAgent(
  client: AbadgeUserClient,
  opts: { name: string; kind: AgentKind; description?: string; json?: boolean },
): Promise<void> {
  const result = await client.agents.create({
    name: opts.name,
    kind: opts.kind,
    issueBootstrapToken: true,
    metadata: opts.description ? { description: opts.description } : {},
  });

  if (opts.json) {
    json(result);
    return;
  }

  success(`Agent "${result.agent.name}" registered (id: ${result.agent.id}).`);
  if (result.bootstrapToken) {
    console.log("");
    warn("Save this bootstrap token — it expires in 10 minutes and is shown once:");
    console.log(`  ${result.bootstrapToken}`);
  }
}

/**
 * Enroll an agent against an already-generated Ed25519 public key (read
 * from a JWK file on disk). The CLI does not write a local private key —
 * the operator manages it externally.
 */
export async function registerWithExistingPublicKey(
  client: AbadgeUserClient,
  opts: {
    name: string;
    kind: AgentKind;
    description?: string;
    json?: boolean;
    publicKeyPath: string;
  },
): Promise<void> {
  const fs = await import("node:fs");
  const raw = fs.readFileSync(opts.publicKeyPath, "utf-8");
  // Accept either a raw JWK JSON or a wrapped {publicKey: "..."} envelope.
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const jwk =
    typeof parsed.kty === "string"
      ? parsed
      : typeof parsed.publicKey === "string"
        ? (JSON.parse(parsed.publicKey as string) as Record<string, unknown>)
        : null;
  if (!jwk || typeof jwk.x !== "string" || jwk.kty !== "OKP") {
    error(`Public-key file ${opts.publicKeyPath} is not a valid Ed25519 JWK.`);
    process.exit(1);
  }
  const publicKeySerialized = JSON.stringify(jwk);

  const result = await client.agents.create({
    name: opts.name,
    kind: opts.kind,
    publicKey: publicKeySerialized,
    metadata: opts.description ? { description: opts.description } : {},
  });

  if (opts.json) {
    json({ agent: result.agent });
    return;
  }
  success(`Agent "${result.agent.name}" registered (id: ${result.agent.id}).`);
}

/**
 * Resolve a registered `local_mcp` agent by id from the API and locate its
 * local private key, then print the Claude Desktop snippet. Resolving via the
 * API (not just ~/.abadge/config.json) means an agent registered with `--json`
 * — which never writes the `mcp` config slot — can still produce a snippet, as
 * long as its key file exists locally.
 */
export async function printMcpConfigForAgent(client: AbadgeUserClient, id: string): Promise<void> {
  const apiUrl = loadConfig()?.apiUrl;
  if (!apiUrl) {
    error("Could not resolve ABADGE_API_URL from local config; run `abadge login` first.");
    process.exit(1);
  }

  // agents.get is org-scoped, so a cross-org or unknown id surfaces as a
  // NOT_FOUND error caught by the action handler below.
  const { agent } = await client.agents.get(id);

  if (agent.kind !== "local_mcp") {
    error(
      `Agent ${id} is a ${agent.kind} agent, not local_mcp. mcp-config only applies to local_mcp agents.`,
    );
    process.exit(1);
  }

  const privateKeyPath = localAgentKeyPath(id);
  if (!existsSync(privateKeyPath)) {
    error(
      `No local private key found for agent ${id} at ${privateKeyPath}. ` +
        "The MCP server needs this key to authenticate; register the agent on this machine " +
        "with `abadge agent add --kind local_mcp` (which writes the key) before generating a config.",
    );
    process.exit(1);
  }

  const snippet = buildMcpConfigSnippet({
    agentId: id,
    apiUrl,
    privateKeyPath,
    binaryPath: defaultMcpBinaryPath(),
  });
  console.log(snippet);
}

export function createAgentCommand(): Command {
  const cmd = new Command("agent").description("Manage agents");

  cmd
    .command("add")
    .description("Register a new agent (Ed25519 keypair only)")
    .requiredOption("-n, --name <name>", "Agent name")
    .option("-k, --kind <kind>", "Agent kind", "local_cli")
    .option("-d, --description <text>", "Agent description")
    .option(
      "--mcp-config",
      "After registering a local_mcp agent, print a Claude Desktop config snippet",
    )
    .option("--bootstrap", "Issue a one-time bootstrap token instead of generating a local keypair")
    .option("--public-key <path>", "Path to an existing Ed25519 public-key JWK to enroll")
    .option("--json", "Output as JSON")
    .action(
      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: agent.add orchestrates flag validation + auth-method branching + JSON/text output paths; complexity is intentional and matches the existing convention on permission.ts / run.ts.
      async (opts: {
        name: string;
        kind: string;
        description?: string;
        mcpConfig?: boolean;
        bootstrap?: boolean;
        publicKey?: string;
        json?: boolean;
      }) => {
        if (!AGENT_KINDS.includes(opts.kind as AgentKind)) {
          error(`--kind must be one of: ${AGENT_KINDS.join(", ")}`);
          process.exit(1);
        }
        const kind = opts.kind as AgentKind;

        if (opts.bootstrap && opts.publicKey) {
          error("--bootstrap and --public-key are mutually exclusive.");
          process.exit(1);
        }
        if (opts.mcpConfig && kind !== "local_mcp") {
          error("--mcp-config is only valid with --kind local_mcp.");
          process.exit(1);
        }
        if (opts.mcpConfig && opts.json) {
          // --mcp-config is a human-paste workflow; --json is for script consumers.
          // Mixing them would emit two top-level JSON documents on stdout. Prefer
          // running `abadge agent add --json` and then `abadge agent mcp-config <id>`.
          error(
            "--mcp-config cannot be combined with --json. Run `abadge agent add --json` first, then `abadge agent mcp-config <id>` to print the snippet.",
          );
          process.exit(1);
        }
        if (opts.mcpConfig && !loadConfig()?.apiUrl) {
          error("Could not resolve ABADGE_API_URL from local config; run `abadge login` first.");
          process.exit(1);
        }

        try {
          const client = await createUserApiClient();
          if (opts.bootstrap) {
            await registerBootstrapAgent(client, { ...opts, kind });
          } else if (opts.publicKey) {
            await registerWithExistingPublicKey(client, {
              ...opts,
              kind,
              publicKeyPath: opts.publicKey,
            });
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
    .argument("<id>", "Agent ID of a local_mcp agent in the active organization")
    .action(async (id: string) => {
      try {
        const client = await createUserApiClient();
        await printMcpConfigForAgent(client, id);
      } catch (err) {
        error(errorMessage(err, "Failed to build MCP config."));
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("List all agents")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const client = await createUserApiClient();
        const agents = (await client.agents.list()).agents;

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
    .command("rm")
    .description("Revoke an agent")
    .argument("<id>", "Agent ID")
    .action(async (id: string) => {
      try {
        const client = await createUserApiClient();
        await client.agents.delete(id);
        success(`Agent ${id} revoked.`);
      } catch (err) {
        error(errorMessage(err, "Failed to revoke agent."));
        process.exit(1);
      }
    });

  return cmd;
}
