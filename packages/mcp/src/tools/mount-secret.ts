import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";
import { getApiClient } from "../api-client.js";
import type { McpConfig } from "../config.js";
import { resolveSecret } from "../resolve-secret.js";

export const toolName = "mount_secret";

export const toolDescription =
  "Mount a secret as a temporary file with restricted permissions (0600). Returns only the file path — never the secret content. Auto-cleans after 5 minutes.";

export const toolInputSchema = z.object({
  itemId: z.string().describe("ID of the item to mount"),
  filename: z.string().optional().describe("Custom filename (default: item ID)"),
  purpose: z.string().optional().describe("Why this credential is needed"),
});

export async function handler(
  input: z.infer<typeof toolInputSchema>,
  config: McpConfig,
): Promise<string> {
  const client = await getApiClient(config);
  const secret = await resolveSecret(client, input.itemId, "file");

  const suffix = randomBytes(8).toString("hex");
  const dir = join(tmpdir(), `abadge-${suffix}`);
  await mkdir(dir, { mode: 0o700 });

  const sanitized = basename(input.filename ?? input.itemId);
  const filePath = join(dir, sanitized);
  if (!filePath.startsWith(`${dir}/`)) {
    throw new Error("Invalid filename");
  }

  await writeFile(filePath, secret, { mode: 0o600 });

  // Auto-cleanup after 5 minutes
  setTimeout(
    () => {
      void unlink(filePath).catch(() => {});
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
