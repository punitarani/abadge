import { createNodeTrpcClient, normalizeTrpcError } from "@abadge/trpc/client";
import type { McpConfig } from "./config.js";

const clientCache = new Map<string, ReturnType<typeof createNodeTrpcClient>>();

export function getApiClient(config: McpConfig): ReturnType<typeof createNodeTrpcClient> {
  const key = `${config.apiUrl}::${config.authToken}`;
  const existing = clientCache.get(key);
  if (existing) {
    return existing;
  }

  const client = createNodeTrpcClient({
    baseUrl: config.apiUrl,
    token: config.authToken,
  });
  clientCache.set(key, client);
  return client;
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const normalized = normalizeTrpcError(error);
  return normalized.message || fallback;
}
