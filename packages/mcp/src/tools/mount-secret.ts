import { mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { apiPost } from "../api-client.js";
import type { McpConfig } from "../config.js";

export const toolName = "mount_secret_file";

export const toolDescription =
  "Mount a credential as a temporary file with restricted permissions. Returns the file path.";

export const toolInputSchema = z.object({
  credentialName: z.string().describe("Name of the credential to mount"),
  path: z.string().optional().describe("Custom file path (default: auto-generated temp file)"),
  purpose: z.string().optional().describe("Why this credential is needed"),
});

interface AccessResponse {
  credential?: { name: string; type: string; value: string };
  error?: string;
}

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const res = await apiPost<AccessResponse>(config, "/v1/credentials/access", {
    credentialName: input.credentialName,
    purpose: input.purpose ?? "Mount as temporary file",
  });

  if (!res.ok || !res.data.credential?.value) {
    return JSON.stringify({ error: res.data.error ?? "Failed to access credential" });
  }

  const filePath = input.path ?? join(mkdtempSync(join(tmpdir(), "abadge-")), input.credentialName);

  writeFileSync(filePath, res.data.credential.value, { mode: 0o600 });

  // Schedule cleanup after 5 minutes
  setTimeout(
    () => {
      try {
        unlinkSync(filePath);
      } catch {
        // File may already be removed
      }
    },
    5 * 60 * 1000,
  );

  // Return path only, never the secret content
  return JSON.stringify({
    path: filePath,
    permissions: "0600",
    message: "Secret mounted. File will be auto-cleaned after 5 minutes.",
  });
}
