import { AbadgeClient } from "@abadge/sdk";
import type { McpConfig } from "./config.js";

let cached: AbadgeClient | null = null;
let cachedKey: string | null = null;

export function getApiClient(config: McpConfig): AbadgeClient {
  const key = `${config.apiUrl}::${config.authToken}`;
  if (!cached || cachedKey !== key) {
    cached = new AbadgeClient({ apiUrl: config.apiUrl, token: config.authToken });
    cachedKey = key;
  }
  return cached;
}
