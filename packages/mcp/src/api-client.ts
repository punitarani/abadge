import { AbadgeClient } from "@abadge/sdk";
import type { McpConfig } from "./config.js";

let cached: AbadgeClient | null = null;

export function getApiClient(config: McpConfig): AbadgeClient {
  if (!cached) {
    cached = new AbadgeClient({ apiUrl: config.apiUrl, token: config.authToken });
  }
  return cached;
}
