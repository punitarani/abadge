import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { toErrorPayload } from "../errors.js";

export const toolName = "get_audit";

export const toolDescription = "Get recent audit log entries. Optionally filter by item ID.";

export const toolInputSchema = z.object({
  itemId: z.string().optional().describe("Filter by item ID"),
  limit: z.number().min(1).max(100).optional().describe("Max entries to return (default 20)"),
});

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = await getApiClient(config);

  try {
    const response = await client.getAudit({
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
    });

    return JSON.stringify({ entries: response.entries });
  } catch (error) {
    return JSON.stringify(toErrorPayload(error, "Failed to fetch audit logs"));
  }
}
