import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpConfig {
  apiUrl: string;
  token: string;
}

function loadConfigFile(): Partial<McpConfig> {
  try {
    const configPath = join(homedir(), ".abadge", "config.json");
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      apiUrl: typeof parsed.apiUrl === "string" ? parsed.apiUrl : undefined,
      token: typeof parsed.token === "string" ? parsed.token : undefined,
    };
  } catch {
    return {};
  }
}

export function loadConfig(): McpConfig {
  const file = loadConfigFile();
  const env = globalThis.process?.env ?? {};
  const apiUrl = env.ABADGE_API_URL ?? file.apiUrl;
  const token = env.ABADGE_TOKEN ?? file.token;

  if (!apiUrl) {
    throw new Error("ABADGE_API_URL is required (env or ~/.abadge/config.json)");
  }
  if (!token) {
    throw new Error("ABADGE_TOKEN is required (env or ~/.abadge/config.json)");
  }

  return { apiUrl, token };
}
