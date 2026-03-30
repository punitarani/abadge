import { z } from "zod";
import { apiPost } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "request_secret_use";

export const toolDescription =
  "Request to use a credential with a specific delivery mode. Does NOT return the secret value.";

const deliveryModes = ["env_inject", "file_mount_tmpfs", "operation_only"] as const;

export const toolInputSchema = z.object({
  credentialName: z.string().describe("Name of the credential to access"),
  deliveryMode: z.enum(deliveryModes).describe("How the secret should be delivered"),
  purpose: z.string().describe("Why this credential is needed"),
});

interface AccessResponse {
  credential?: { name: string; type: string };
  error?: string;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const res = await apiPost<AccessResponse>(config, "/v1/credentials/access", {
    credentialName: input.credentialName,
    purpose: input.purpose,
  });

  if (!res.ok) {
    return JSON.stringify({
      status: "denied",
      error: res.data.error ?? "Access denied",
    });
  }

  // Never return the raw secret value to the LLM
  return JSON.stringify({
    status: "granted",
    credentialName: res.data.credential?.name ?? input.credentialName,
    credentialType: res.data.credential?.type,
    deliveryMode: input.deliveryMode,
    message: `Access granted. Credential will be delivered via ${input.deliveryMode}.`,
  });
}
