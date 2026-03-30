import { z } from "zod";
import { apiGet } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "get_secret_metadata";

export const toolDescription = "Get metadata about a credential without accessing its value";

export const toolInputSchema = z.object({
  credentialName: z.string().describe("Name of the credential"),
});

interface CredentialEntry {
  id: string;
  name: string;
  type: string;
  metadata: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  credentials?: CredentialEntry[];
  error?: string;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  // List credentials and find by name — avoids triggering an access log entry
  const res = await apiGet<ListResponse>(config, "/v1/credentials");

  if (!res.ok) {
    return JSON.stringify({ error: res.data.error ?? "Failed to fetch credential metadata" });
  }

  const match = res.data.credentials?.find((c) => c.name === input.credentialName);
  if (!match) {
    return JSON.stringify({ error: `Credential "${input.credentialName}" not found` });
  }

  return JSON.stringify({
    name: match.name,
    type: match.type,
    metadata: match.metadata,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
  });
}
