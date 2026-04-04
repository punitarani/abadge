import { readFileSync } from "node:fs";
import { AbadgeClient } from "@abadge/sdk";
import type { McpConfig } from "./config.js";

let cachedLegacyClient: AbadgeClient | null = null;
let cachedLegacyKey: string | null = null;
let cachedSessionClient: AbadgeClient | null = null;
let cachedSessionKey: string | null = null;
let cachedSessionExpiresAt = 0;
let warnedLegacyToken = false;

function parseJwk(serialized: string): unknown {
  return JSON.parse(serialized);
}

function textToBytes(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value);
  const cloned = new Uint8Array(bytes.length);
  cloned.set(bytes);
  return cloned.buffer;
}

async function signWithPrivateKey(privateKey: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    parseJwk(privateKey) as never,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("Ed25519", key, textToBytes(message));
  return Buffer.from(signature).toString("base64");
}

function expiresSoon(expiresAt: number): boolean {
  return expiresAt <= Date.now() + 30_000;
}

function parseExpiry(expiresAt: string): number {
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getApiClient(config: McpConfig): Promise<AbadgeClient> {
  if (config.authToken) {
    const key = `${config.apiUrl}::${config.authToken}`;
    if (!cachedLegacyClient || cachedLegacyKey !== key) {
      cachedLegacyClient = new AbadgeClient({ apiUrl: config.apiUrl, token: config.authToken });
      cachedLegacyKey = key;
    }

    if (!warnedLegacyToken) {
      warnedLegacyToken = true;
      console.error(
        "abadge-mcp: ABADGE_AUTH_TOKEN is deprecated. Switch to ABADGE_AGENT_ID + ABADGE_PRIVATE_KEY_PATH.",
      );
    }

    return cachedLegacyClient;
  }

  if (!config.agentId || !config.privateKeyPath) {
    throw new Error("Missing MCP agent identity. Configure agentId and privateKeyPath.");
  }

  const cacheKey = `${config.apiUrl}::${config.agentId}::${config.privateKeyPath}`;
  if (
    cachedSessionClient &&
    cachedSessionKey === cacheKey &&
    !expiresSoon(cachedSessionExpiresAt)
  ) {
    return cachedSessionClient;
  }

  const privateKey = readFileSync(config.privateKeyPath, "utf-8");
  const anonymousClient = new AbadgeClient({ apiUrl: config.apiUrl });
  const challenge = await anonymousClient.createAgentChallenge({ agentId: config.agentId });
  const signature = await signWithPrivateKey(privateKey, challenge.challenge);
  const session = await anonymousClient.exchangeAgentSession({
    agentId: config.agentId,
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    signature,
  });

  cachedSessionClient = new AbadgeClient({
    apiUrl: config.apiUrl,
    token: session.session.token,
  });
  cachedSessionKey = cacheKey;
  cachedSessionExpiresAt = parseExpiry(session.session.expiresAt);

  return cachedSessionClient;
}
