import { z } from "zod";
import { apiGet } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "list_items";

export const toolDescription =
  "List stored items (credentials/secrets). Returns metadata only — IDs, storage mode, timestamps. Never returns secret values.";

export const toolInputSchema = z.object({});

interface ItemEntry {
  id: string;
  name: string;
  storageMode: string;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items?: ItemEntry[];
  error?: string;
}

export async function handler(_input: z.infer<typeof toolInputSchema>, config: McpConfig): Promise<string> {
  const res = await apiGet<ListResponse>(config, "/v1/items");

  if (!res.ok) {
    return JSON.stringify({ error: res.data.error ?? "Failed to list items" });
  }

  const items = (res.data.items ?? []).map(({ id, name, storageMode, createdAt, updatedAt }) => ({
    id,
    name,
    storageMode,
    createdAt,
    updatedAt,
  }));

  return JSON.stringify({ items });
}
