import type { AbadgeClient } from "./client";

export async function createAndStoreSession(params: {
  client: AbadgeClient;
  agentId: string;
  scopes?: string[];
  deliveryModes?: string[];
  ttlSeconds?: number;
}): Promise<{ sessionId: string; token: string; expiresAt: string }> {
  const { client, agentId, scopes, deliveryModes } = params;
  const ttlSeconds = params.ttlSeconds ?? 3600;

  return client.createSession({
    agentId,
    scopes,
    allowedDeliveryModes: deliveryModes,
    ttlSeconds,
  });
}

export async function revokeSession(client: AbadgeClient, sessionId: string): Promise<void> {
  await client.revokeSession(sessionId);
}
