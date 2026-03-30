import { z } from "zod";
import { apiGet } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "request_approval";

export const toolDescription =
  "Check the status of a pending approval request or list pending approvals";

export const toolInputSchema = z.object({
  approvalId: z.string().optional().describe("Specific approval ID to check"),
});

interface ApprovalResponse {
  approvals?: Array<{ id: string; status: string; credentialName: string; createdAt: string }>;
  approval?: { id: string; status: string; credentialName: string; createdAt: string };
  error?: string;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const path = input.approvalId ? `/v1/approvals/${input.approvalId}` : "/v1/approvals";

  const res = await apiGet<ApprovalResponse>(config, path);

  if (!res.ok) {
    return JSON.stringify({ error: res.data.error ?? "Failed to fetch approvals" });
  }

  if (input.approvalId && res.data.approval) {
    return JSON.stringify({ approval: res.data.approval });
  }

  return JSON.stringify({ approvals: res.data.approvals ?? [] });
}
