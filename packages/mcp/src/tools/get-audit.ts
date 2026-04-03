import { AbadgeApiError } from "@abadge/sdk";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";

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
  const client = getApiClient(config);

  try {
    const response = await client.getAudit({
      ...(input.limit ? { limit: input.limit } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
    });

    return JSON.stringify({ entries: response.entries });
  } catch (error) {
    const message = error instanceof AbadgeApiError ? error.message : "Failed to fetch audit logs";
    return JSON.stringify({ error: message });
  }
}
