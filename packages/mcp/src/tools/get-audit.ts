import { z } from "zod";
import { apiGet } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "get_audit";

export const toolDescription = "Get recent audit log entries. Optionally filter by item ID.";

export const toolInputSchema = z.object({
  itemId: z.string().optional().describe("Filter by item ID"),
  limit: z.number().min(1).max(100).optional().describe("Max entries to return (default 20)"),
});

interface AuditEntry {
  id: string;
  itemId: string;
  action: string;
  capability: string | null;
  outcome: string;
  timestamp: string;
}

interface AuditResponse {
  entries?: AuditEntry[];
  error?: string;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const params = new URLSearchParams();
  if (input.limit) params.set("limit", String(input.limit));
  if (input.itemId) params.set("itemId", input.itemId);

  const query = params.toString();
  const path = query ? `/v1/audit?${query}` : "/v1/audit";
  const res = await apiGet<AuditResponse>(config, path);

  if (!res.ok) {
    return JSON.stringify({ error: res.data.error ?? "Failed to fetch audit logs" });
  }

  const entries = (res.data.entries ?? []).map(
    ({ id, itemId, action, capability, outcome, timestamp }) => ({
      id,
      itemId,
      action,
      capability,
      outcome,
      timestamp,
    }),
  );

  return JSON.stringify({ entries });
}
