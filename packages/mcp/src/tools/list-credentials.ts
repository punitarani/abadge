import { z } from "zod";
import { apiGet } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "list_available_credentials";

export const toolDescription =
  "List credentials you have access to, showing name, type, environment, and sensitivity";

export const toolInputSchema = z.object({});

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

function formatCredentials(response: ListResponse): string {
  const creds = (response.credentials ?? []).map(({ id, name, type, metadata }) => ({
    id,
    name,
    type,
    metadata,
  }));
  return JSON.stringify({ credentials: creds });
}

export async function handler(
  _input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const res = await apiGet<ListResponse>(config, "/v1/credentials");

  if (!res.ok) {
    return JSON.stringify({ error: res.data.error ?? "Failed to list credentials" });
  }

  return formatCredentials(res.data);
}
