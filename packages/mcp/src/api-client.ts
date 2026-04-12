import { readFileSync } from "node:fs";
import type { Ed25519PrivateKeyJwk } from "@abadge/sdk";
import { AbadgeAgentClient } from "@abadge/sdk";
import type { McpConfig } from "./config.js";

let cached: AbadgeAgentClient | null = null;
let cachedKey: string | null = null;
let connected = false;

export async function getApiClient(config: McpConfig): Promise<AbadgeAgentClient> {
  const key = `${config.apiUrl}::${config.agentId}`;

  if (!cached || cachedKey !== key) {
    let privateKey: Ed25519PrivateKeyJwk | string;
    if (config.privateKey) {
      // Inline JWK string — pass directly to SDK (which now accepts strings)
      privateKey = config.privateKey;
    } else if (config.privateKeyPath) {
      privateKey = JSON.parse(readFileSync(config.privateKeyPath, "utf-8")) as Ed25519PrivateKeyJwk;
    } else {
      throw new Error("No private key configured (privateKey or privateKeyPath required).");
    }

    cached = new AbadgeAgentClient({
      apiUrl: config.apiUrl,
      agentId: config.agentId,
      privateKey,
    });
    cachedKey = key;
    connected = false;
  }

  if (!connected && cached) {
    await cached.connect();
    connected = true;
  }

  return cached;
}
