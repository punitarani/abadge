import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpConfig {
  apiUrl: string;
  authToken: string;
}

function loadConfigFile(): Partial<McpConfig> {
  try {
    const configPath = join(homedir(), ".abadge", "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : undefined,
      authToken: typeof parsed.authToken === "string" ? parsed.authToken : undefined,
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

  if (!apiUrl) {
    throw new Error("ABADGE_API_URL is required (env or ~/.abadge/config.json)");
  }
  if (!authToken) {
    throw new Error("ABADGE_AUTH_TOKEN is required (env or ~/.abadge/config.json)");
  }

  return { apiUrl, authToken };
}
