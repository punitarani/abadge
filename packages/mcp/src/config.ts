import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpConfig {
  apiUrl: string;
  /** Keypair auth (preferred) */
  agentId?: string;
  privateKeyPath?: string;
  /** Legacy API key auth */
  authToken?: string;
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
      authToken:
        typeof parsed.authToken === "string"
          ? parsed.authToken
          : typeof parsed.principalSecret === "string"
            ? parsed.principalSecret
            : undefined,
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
  const authToken = env.ABADGE_AUTH_TOKEN ?? env.ABADGE_TOKEN ?? file.authToken;

  if (!apiUrl) {
    throw new Error("ABADGE_API_URL is required (env or ~/.abadge/config.json)");
  }
  if (!agentId && !authToken) {
    throw new Error(
      "Either ABADGE_AGENT_ID + ABADGE_PRIVATE_KEY_PATH or ABADGE_AUTH_TOKEN is required",
    );
  }

  return { apiUrl, agentId, privateKeyPath, authToken };
}
