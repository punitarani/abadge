import { readFileSync } from "node:fs";
import type { Ed25519PrivateKeyJwk } from "@abadge/sdk";
import { AbadgeAgentClient } from "@abadge/sdk";
import type { McpConfig } from "./config.js";

let cached: AbadgeAgentClient | null = null;
let cachedKey: string | null = null;
let connected = false;

// Test seam: unit tests can swap `clientFactory` to inject a fake client
// without going through `mock.module("@abadge/sdk")`, which is sticky across
// the whole test process and breaks unrelated tests
// (e.g. sdk/resolve-private-key) that import the real `AbadgeAgentClient`.
type AgentClientFactory = (opts: {
  apiUrl: string;
  agentId: string;
  privateKey: Ed25519PrivateKeyJwk | string;
}) => AbadgeAgentClient;

const defaultClientFactory: AgentClientFactory = (opts) => new AbadgeAgentClient(opts);
let clientFactory: AgentClientFactory = defaultClientFactory;

/** @internal */
export function __setAgentClientFactoryForTests(factory: AgentClientFactory): void {
  clientFactory = factory;
  cached = null;
  cachedKey = null;
  connected = false;
}

/** @internal */
export function __resetAgentClientFactoryForTests(): void {
  clientFactory = defaultClientFactory;
  cached = null;
  cachedKey = null;
  connected = false;
}

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

    cached = clientFactory({
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
