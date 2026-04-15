import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpConfig {
  apiUrl: string;
  agentId: string;
  /** Path to Ed25519 JWK file. Mutually exclusive with privateKey. */
  privateKeyPath?: string;
  /** Inline Ed25519 JWK JSON string. Mutually exclusive with privateKeyPath. */
  privateKey?: string;
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
  const agentId = env.ABADGE_MCP_AGENT_ID ?? env.ABADGE_AGENT_ID ?? file.agentId;
  const privateKey = env.ABADGE_MCP_PRIVATE_KEY ?? env.ABADGE_PRIVATE_KEY;
  const privateKeyPath = env.ABADGE_PRIVATE_KEY_PATH ?? file.privateKeyPath;

  if (!apiUrl) {
    throw new Error("ABADGE_API_URL is required (env or ~/.abadge/config.json)");
  }
  if (!agentId) {
    throw new Error("ABADGE_AGENT_ID is required (env or ~/.abadge/config.json).");
  }
  if (!privateKey && !privateKeyPath) {
    throw new Error(
      "ABADGE_PRIVATE_KEY or ABADGE_PRIVATE_KEY_PATH is required (env or ~/.abadge/config.json).",
    );
  }

  return { apiUrl, agentId, privateKeyPath, privateKey };
}
