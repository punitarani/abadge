import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { toErrorPayload } from "../errors.js";

export const toolName = "list_items";

export const toolDescription =
  "List stored items (credentials/secrets). Returns metadata only — IDs, storage mode, timestamps. Never returns secret values.";

export const toolInputSchema = z.object({});

export async function handler(
  _input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = await getApiClient(config);

  try {
    const response = await client.listItems();
    return JSON.stringify({ items: response.items });
  } catch (error) {
    return JSON.stringify(toErrorPayload(error, "Failed to list items"));
  }
}
