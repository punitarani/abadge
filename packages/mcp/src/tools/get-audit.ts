import { z } from "zod";
import { apiGet } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "get_audit_context";

export const toolDescription = "Get recent audit log entries for a credential";

export const toolInputSchema = z.object({
  credentialName: z.string().optional().describe("Filter by credential name"),
  limit: z.number().min(1).max(100).optional().describe("Max entries to return (default 20)"),
});

interface AuditEntry {
  id: number;
  agentName: string;
  credentialName: string;
  action: string;
  purpose: string | null;
  timestamp: string;
}

interface AuditResponse {
  logs?: AuditEntry[];
  error?: string;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const limit = input.limit ?? 20;
  const res = await apiGet<AuditResponse>(config, `/v1/audit?limit=${limit}`);

  if (!res.ok) {
    return JSON.stringify({ error: res.data.error ?? "Failed to fetch audit logs" });
  }

  let logs = res.data.logs ?? [];

  if (input.credentialName) {
    logs = logs.filter((entry) => entry.credentialName === input.credentialName);
  }

  return JSON.stringify({
    entries: logs.map(({ id, agentName, credentialName, action, purpose, timestamp }) => ({
      id,
      agentName,
      credentialName,
      action,
      purpose,
      timestamp,
    })),
  });
}
