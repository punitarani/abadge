import { z } from "zod";
import { getApiClient, getApiErrorMessage } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "list_items";

export const toolDescription =
  "List stored items (credentials/secrets). Returns metadata only — IDs, storage mode, timestamps. Never returns secret values.";

export const toolInputSchema = z.object({});

export async function handler(
  _input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = getApiClient(config);

  try {
    const response = await client.items.list.query();
    return JSON.stringify({ items: response.items });
  } catch (error) {
    return JSON.stringify({ error: getApiErrorMessage(error, "Failed to list items") });
  }
}
