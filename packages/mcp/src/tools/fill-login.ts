import { z } from "zod";
import { apiPost } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "fill_login";

export const toolDescription =
  "Get instructions for browser-based login credential filling. Returns the target URL and field identifiers, NOT the raw password.";

export const toolInputSchema = z.object({
  credentialName: z.string().describe("Name of the login credential"),
  targetUrl: z.string().describe("URL of the login page"),
});

interface AccessResponse {
  credential?: { name: string; type: string; metadata: Record<string, string> | null };
  error?: string;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  // Verify access without exposing the secret
  const res = await apiPost<AccessResponse>(config, "/v1/credentials/access", {
    credentialName: input.credentialName,
    purpose: `Browser login fill for ${input.targetUrl}`,
  });

  if (!res.ok) {
    return JSON.stringify({ error: res.data.error ?? "Access denied" });
  }

  // Return fill instructions — the actual credential fill happens through the broker,
  // never through the LLM
  return JSON.stringify({
    action: "browser_fill",
    targetUrl: input.targetUrl,
    credentialName: input.credentialName,
    usernameField: res.data.credential?.metadata?.usernameField ?? "username",
    passwordField: res.data.credential?.metadata?.passwordField ?? "password",
    message:
      "Credential fill instructions ready. The broker will handle the actual credential injection.",
  });
}
