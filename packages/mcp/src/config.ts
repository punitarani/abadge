import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpConfig {
  apiUrl: string;
  authToken?: string;
  agentId?: string;
  privateKeyPath?: string;
}

function getConfigPath(): string {
  const home = globalThis.process?.env?.HOME || homedir();
  return join(home, ".abadge", "config.json");
}

function readAgentField(
  record: Record<string, unknown> | null,
  field: "agentId" | "privateKeyPath",
): string | undefined {
  const value = record?.[field];
  return typeof value === "string" ? value : undefined;
}

function readLocalAgentReferences(parsed: Record<string, unknown>): {
  agentId?: string;
  privateKeyPath?: string;
} {
  const localAgents =
    parsed.localAgents && typeof parsed.localAgents === "object"
      ? (parsed.localAgents as Record<string, unknown>)
      : null;
  const mcpAgent =
    localAgents?.mcp && typeof localAgents.mcp === "object"
      ? (localAgents.mcp as Record<string, unknown>)
      : null;
  const cliAgent =
    localAgents?.cli && typeof localAgents.cli === "object"
      ? (localAgents.cli as Record<string, unknown>)
      : null;

  return {
    agentId: readAgentField(mcpAgent, "agentId") ?? readAgentField(cliAgent, "agentId"),
    privateKeyPath:
      readAgentField(mcpAgent, "privateKeyPath") ?? readAgentField(cliAgent, "privateKeyPath"),
  };
}

function loadConfigFile(): Partial<McpConfig> {
  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const localAgentReference = readLocalAgentReferences(parsed);

    return {
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : undefined,
      agentId: localAgentReference.agentId,
      privateKeyPath: localAgentReference.privateKeyPath,
    };
  } catch {
    return {};
  }
}

export function loadConfig(): McpConfig {
  const file = loadConfigFile();
  const env = globalThis.process?.env ?? {};
  const apiUrl = env.ABADGE_API_URL ?? file.apiUrl;
  const authToken = env.ABADGE_AUTH_TOKEN ?? file.authToken;
  const agentId = env.ABADGE_MCP_AGENT_ID ?? env.ABADGE_AGENT_ID ?? file.agentId;
  const privateKeyPath =
    env.ABADGE_MCP_PRIVATE_KEY_PATH ?? env.ABADGE_PRIVATE_KEY_PATH ?? file.privateKeyPath;

  if (!apiUrl) {
    throw new Error("ABADGE_API_URL is required (env or ~/.abadge/config.json)");
  }

  if (!authToken && (!agentId || !privateKeyPath)) {
    throw new Error(
      "Set ABADGE_AGENT_ID and ABADGE_PRIVATE_KEY_PATH, or run `abadge login` to provision local agent metadata.",
    );
  }

  return {
    apiUrl,
    ...(authToken ? { authToken } : {}),
    ...(agentId ? { agentId } : {}),
    ...(privateKeyPath ? { privateKeyPath } : {}),
  };
}
