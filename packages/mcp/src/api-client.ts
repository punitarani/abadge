import { AbadgeAgentClient } from "@abadge/sdk";
import type { McpConfig } from "./config.js";

let cached: AbadgeAgentClient | null = null;
let cachedKey: string | null = null;

export function getApiClient(config: McpConfig): AbadgeAgentClient {
  const key = `${config.apiUrl}::${config.authToken}`;
  if (!cached || cachedKey !== key) {
    cached = new AbadgeAgentClient({ apiUrl: config.apiUrl, apiKey: config.authToken });
    cachedKey = key;
  }
  return cached;
}
