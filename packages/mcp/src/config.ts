import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpConfig {
  apiUrl: string;
  agentId: string;
  privateKeyPath: string;
}

function loadConfigFile(): Partial<McpConfig> {
  try {
    const configPath = join(homedir(), ".abadge", "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : undefined,
      agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
      privateKeyPath: typeof parsed.privateKeyPath === "string" ? parsed.privateKeyPath : undefined,
    };
  } catch {
    return {};
  }
}

export function loadConfig(): McpConfig {
  const file = loadConfigFile();
  const env = globalThis.process?.env ?? {};
  const apiUrl = env.ABADGE_API_URL ?? file.apiUrl;
  const agentId = env.ABADGE_AGENT_ID ?? file.agentId;
  const privateKeyPath = env.ABADGE_PRIVATE_KEY_PATH ?? file.privateKeyPath;

  if (!apiUrl) {
    throw new Error("ABADGE_API_URL is required (env or ~/.abadge/config.json)");
  }
  if (!agentId || !privateKeyPath) {
    throw new Error(
      "ABADGE_AGENT_ID and ABADGE_PRIVATE_KEY_PATH are required (env or ~/.abadge/config.json). Legacy API key auth is not supported by the MCP.",
    );
  }

  return { apiUrl, agentId, privateKeyPath };
}
